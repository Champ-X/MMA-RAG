import { translate as t, useTranslation, getLanguage } from '@/i18n'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, Search, ScatterChart, X } from 'lucide-react'
import type { PortraitCluster } from './PortraitGraph'
import { getTopicConstellationHeight, layoutTopicConstellations, type TopicConstellation } from './topicConstellationLayout'
import { getSpatialTopicTarget } from './portraitAtlasNavigation'
import { TopicAtlasGlyph } from './TopicAtlasGlyph'
import './topicAtlas.css'

interface TopicAtlasProps {
  clusters: PortraitCluster[]
  selectedId: string | null
  onSelect: (cluster: PortraitCluster) => void
  onClear: () => void
}

const COLORS = ['teal', 'blue', 'violet', 'amber', 'rose', 'sage'] as const
function keywordsFor(cluster: PortraitCluster) {
  const words = cluster.keywords?.length ? cluster.keywords : cluster.topic_summary.split(/[，。、；：！？\s]+/)
  return [...new Set(words.map(word => word.trim()).filter(Boolean))]
}

/** A compact symbol of the same membership counts; never a sample-level source link. */
function ClusterGlyph({ node }: { node: TopicConstellation }) {
  const { points } = node
  const left = points.length ? Math.min(...points.map(point => point.x)) : -36
  const right = points.length ? Math.max(...points.map(point => point.x)) : 36
  const top = points.length ? Math.min(...points.map(point => point.y)) : -28
  const bottom = points.length ? Math.max(...points.map(point => point.y)) : 28
  const width = Math.max(96, right - left + 24)
  const height = Math.max(72, bottom - top + 24)
  return <svg viewBox={`${(left + right - width) / 2} ${(top + bottom - height) / 2} ${width} ${height}`} className="atlas-cluster-glyph" aria-hidden="true">
    <path d={node.outline} className="atlas-glyph-envelope" />
    {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y}
      r={Math.min(5, 3.8 + Math.log10(Math.max(1, point.weight)) * .4) * node.dotScale} />)}
  </svg>
}

export function TopicAtlas({ clusters, selectedId, onSelect, onClear }: TopicAtlasProps) {
  useTranslation()
  const language = getLanguage()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(760)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  const panelId = useId()
  const hintId = useId()
  const topics = useMemo(() => [...clusters].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id))
    .map((cluster, index) => {
      const keywords = keywordsFor(cluster)
      return { ...cluster, keywords, title: keywords[0] || t('未命名主题'), color: COLORS[index % COLORS.length],
        count: Number.isFinite(cluster.cluster_size) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(cluster.cluster_size))) : 0 }
    }).sort((a, b) => b.count - a.count || a.cluster_id.localeCompare(b.cluster_id)), [clusters, language])
  const total = topics.reduce((sum, topic) => sum + topic.count, 0)
  const search = query.trim().toLocaleLowerCase()
  const matches = useMemo(() => topics.filter(topic =>
    `${topic.title} ${topic.keywords.join(' ')} ${topic.topic_summary}`.toLocaleLowerCase().includes(search)
  ), [topics, search])
  const matchedIds = new Set(matches.map(topic => topic.cluster_id))
  const selected = matches.find(topic => topic.cluster_id === selectedId)
  const reading = selected ?? matches[0]
  const readingIndex = reading ? matches.indexOf(reading) : -1
  const tabStopId = matches.some(topic => topic.cluster_id === focusedId)
    ? focusedId : selected?.cluster_id ?? matches[0]?.cluster_id
  // Search and selection never rearrange the map: a topic keeps its spatial address.
  const canvasHeight = getTopicConstellationHeight(topics.length, canvasWidth)
  const nodes = useMemo(() => layoutTopicConstellations(topics, Math.max(600, canvasWidth), canvasHeight), [topics, canvasWidth, canvasHeight])
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const compact = canvasWidth < 600 || nodes.some(node => node.rx < 54 || node.ry < 52)
  const showMap = view === 'map'
  const share = (count: number) => total > 0 ? (count / total * 100).toFixed(1) : '0'

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect
      // Height follows the topic count; measuring only width avoids feedback
      // when switching between the canvas and the naturally sized mobile list.
      if (width > 0) setCanvasWidth(width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function clearQuery() { setQuery(''); searchRef.current?.focus() }
  function returnToMap() {
    const target = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-topic-id]:not(:disabled)') ?? [])
      .find(button => button.dataset.topicId === reading?.cluster_id)
    target?.focus()
    target?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }
  function clearSelection() {
    const previousId = selectedId
    onClear()
    requestAnimationFrame(() => {
      const target = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-topic-id]:not(:disabled)') ?? [])
        .find(button => button.dataset.topicId === previousId)
      ;(target ?? searchRef.current)?.focus()
    })
  }
  function selectTopic(topic: PortraitCluster, reveal = true) {
    if (topic.cluster_id !== selectedId) onSelect(topic)
    if (reveal && (rootRef.current?.clientWidth ?? 0) < 900) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }))
    }
  }
  function searchKeyword(word: string) {
    setQuery(word)
    onClear()
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  function handleSpatialKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    const buttons = Array.from(canvasRef.current?.querySelectorAll<HTMLButtonElement>('[data-topic-id]:not(:disabled)') ?? [])
    const targetId = getSpatialTopicTarget(event.currentTarget.dataset.topicId ?? '', event.key, buttons.map(button => {
      const { left, top, width, height } = button.getBoundingClientRect()
      return { id: button.dataset.topicId ?? '', left, top, width, height }
    }))
    const target = buttons.find(button => button.dataset.topicId === targetId)
    if (!target) return
    event.preventDefault()
    target.focus()
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return <div className="topic-atlas" ref={rootRef} style={{ '--atlas-canvas-height': `${canvasHeight}px` } as CSSProperties} onKeyDown={event => {
    if (event.key !== 'Escape') return
    if (query) { event.stopPropagation(); clearQuery() }
    else if (selectedId) { event.stopPropagation(); clearSelection() }
  }}>
    <div className="atlas-toolbar">
      <div className="atlas-view-switch" role="group" aria-label={t('主题展示方式')}>
        <button type="button" aria-pressed={showMap} onClick={() => setView('map')}><TopicAtlasGlyph name="constellation" size={19} />{t('聚类视图')}</button>
        <button type="button" aria-pressed={!showMap} onClick={() => setView('list')}><TopicAtlasGlyph name="directory" size={19} />{t('主题目录')}</button>
      </div>
      <label className="atlas-search"><Search size={16} aria-hidden />
        <input ref={searchRef} aria-label={t('搜索主题、关键词或摘要')} placeholder={t('搜索主题、关键词或摘要')}
          value={query} onChange={event => { setQuery(event.target.value); onClear() }} />
        {query && <button type="button" aria-label={t('清空主题搜索')} onClick={clearQuery}><X size={15} aria-hidden /></button>}
      </label>
    </div>
    <div className="atlas-workspace">
      <section className="atlas-main" data-view={showMap ? 'map' : 'list'} aria-label={t('主题聚类')}>
        <div className="atlas-meta"><span className="atlas-meta-count" role="status">{search
          ? t('{{value1}} / {{value2}} 个匹配主题', { value1: matches.length, value2: topics.length })
          : <><strong>{topics.length}</strong> {t('个主题')}<span className="atlas-meta-divider" aria-hidden /><strong>{total.toLocaleString()}</strong> {t('条已归类样本')}</>}</span>
        </div>
        <div ref={canvasRef} className="atlas-canvas" data-view={showMap ? 'map' : 'list'} data-compact={compact}>
          {matches.length === 0 ? <div className="atlas-no-results"><Search size={28} strokeWidth={1.5} aria-hidden /><strong>{t('没有找到匹配主题')}</strong><p>{t('试试其他关键词，或清空搜索查看全部。')}</p><button type="button" onClick={clearQuery}>{t('清空搜索')}</button></div>
          : showMap && !compact ? <div className="atlas-constellation" role="group" aria-label={t('主题聚类图')} aria-describedby={hintId}>
            {topics.map(topic => {
              const node = nodeById.get(topic.cluster_id)!
              const bounds = node.hitBounds
              const matched = matchedIds.has(topic.cluster_id)
              return <button type="button" key={node.id} className="atlas-cluster" data-topic-id={node.id} data-color={topic.color}
                data-reading={reading?.cluster_id === node.id} data-match={matched} data-empty={topic.count === 0}
                style={{ left: node.x + bounds.x, top: node.y + bounds.y, width: bounds.width, height: bounds.height,
                  '--cluster-label-x': `${-bounds.x}px`, '--cluster-label-y': `${node.labelY - bounds.y - 20}px`, '--cluster-count-y': `${node.countY - bounds.y - 9}px` } as CSSProperties}
                disabled={!matched} tabIndex={tabStopId === node.id ? 0 : -1} aria-pressed={selectedId === node.id} aria-controls={panelId}
                aria-label={t('阅读主题：{{value1}}，{{value2}} 条样本', { value1: topic.title, value2: topic.count })}
                onFocus={() => setFocusedId(node.id)} onKeyDown={handleSpatialKey} onClick={() => selectTopic(topic)}>
                <svg className="atlas-cluster-drawing" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} aria-hidden="true">
                  <path className="atlas-cluster-envelope" d={node.outline} />
                  <g className="atlas-cluster-members">{node.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y}
                    r={Math.min(5, 3.8 + Math.log10(Math.max(1, point.weight)) * .4) * node.dotScale} data-sample-weight={point.weight} />)}</g>
                </svg>
                <span className="atlas-cluster-name"><span>{topic.title}</span>{selectedId === node.id && <Check size={13} aria-hidden />}</span>
                <span className="atlas-cluster-count"><b>{topic.count.toLocaleString()}</b> {t('样本')}{topic.keywords.length > 1 && <span> · {topic.keywords.slice(1, 3).join(' / ')}</span>}</span>
              </button>
            })}
          </div> : <div className={showMap ? 'atlas-cluster-stream' : 'atlas-topic-list'} aria-label={showMap ? t('主题群落') : t('主题列表')}>
            {matches.map(topic => <button type="button" key={topic.cluster_id} data-topic-id={topic.cluster_id} data-color={topic.color}
              data-reading={reading?.cluster_id === topic.cluster_id} aria-current={reading?.cluster_id === topic.cluster_id ? 'true' : undefined}
              className={showMap ? 'atlas-stream-topic' : 'atlas-list-row'} aria-pressed={selectedId === topic.cluster_id} aria-controls={panelId}
              aria-label={t('阅读主题：{{value1}}，{{value2}} 条样本', { value1: topic.title, value2: topic.count })} onClick={() => selectTopic(topic)}>
              <ClusterGlyph node={nodeById.get(topic.cluster_id)!} />
              <span className="atlas-list-copy"><span className="atlas-list-heading"><strong>{topic.title}</strong>{!showMap && <span>{topic.keywords.slice(1, 3).join(' · ')}</span>}</span>
                {showMap ? <><span>{topic.keywords.slice(1, 3).join(' · ')}</span><small>{topic.count.toLocaleString()} {t('条样本')}</small></>
                  : <span className="atlas-list-excerpt">{topic.topic_summary || t('该主题暂未生成摘要。')}</span>}
              </span>
              {!showMap && <span className="atlas-list-quantity"><strong>{topic.count.toLocaleString()}<small>{t('样本')}</small></strong><span>{share(topic.count)}%</span></span>}
              <span className="atlas-list-action" title={reading?.cluster_id === topic.cluster_id ? t('正在阅读此主题') : t('点击主题查看完整摘要')}>
                {reading?.cluster_id === topic.cluster_id ? <BookOpen size={16} aria-hidden /> : <ArrowUpRight size={16} aria-hidden />}
              </span>
            </button>)}
          </div>}
        </div>
        <div className="atlas-caption" id={hintId}>
          <span className="atlas-members-legend"><span className="atlas-legend-dots" aria-hidden><i /><i /><i /></span>{showMap ? t('主题分组示意 · 位置仅作排版') : t('点击主题查看完整摘要')}</span>
          <span className="atlas-keyboard-hint"><kbd>{showMap && !compact ? '↑ ↓ ← →' : 'Tab'}</kbd>{t('切换')}<kbd>Enter</kbd>{t('阅读')}</span>
        </div>
      </section>
      <aside className="atlas-detail" id={panelId} ref={detailRef} aria-label={t('主题阅读面板')} data-color={reading?.color ?? 'teal'}>
        <div className="atlas-detail-nav"><h3>{t('走进这个主题')}</h3><button type="button" className="atlas-return-map" onClick={returnToMap}><ArrowLeft size={14} aria-hidden />{t('返回主题')}</button><div className="atlas-paging"><span aria-live="polite">{String(readingIndex + 1).padStart(2, '0')}<span> / {String(matches.length).padStart(2, '0')}</span></span>
          <button type="button" aria-label={t('上一个主题')} disabled={readingIndex <= 0} onClick={() => selectTopic(matches[readingIndex - 1], false)}><ChevronLeft size={17} aria-hidden /></button>
          <button type="button" aria-label={t('下一个主题')} disabled={readingIndex < 0 || readingIndex >= matches.length - 1} onClick={() => selectTopic(matches[readingIndex + 1], false)}><ChevronRight size={17} aria-hidden /></button>
        </div></div>
        {reading ? <>
          <div className="atlas-reading-body" key={reading.cluster_id} tabIndex={0} role="region" aria-label={t('主题摘要')}>
            <div className="atlas-reading-title"><div><h4>{reading.title}</h4><p className="atlas-reading-stats"><strong>{reading.count.toLocaleString()}</strong> {t('条样本')}<span aria-hidden>·</span>{share(reading.count)}%</p></div><ClusterGlyph node={nodeById.get(reading.cluster_id)!} /></div>
            <div className="atlas-summary-label">{t('主题摘要')}</div><p className="atlas-summary">{reading.topic_summary || t('该主题暂未生成摘要。')}</p>
          </div>
          {reading.keywords.length > 1 && <div className="atlas-keyword-section"><div className="atlas-keywords-heading"><h5>{t('沿着关键词探索')}</h5><span>{t('点击查找相关主题')}</span></div><div className="atlas-keywords">{reading.keywords.slice(1).map(word => <button type="button" key={word} onClick={() => searchKeyword(word)}>{word}<ArrowUpRight size={11} aria-hidden /></button>)}</div></div>}
          <div className="atlas-detail-footer">{selected ? <><span><Check size={13} aria-hidden />{t('正在阅读此主题')}</span><button type="button" onClick={clearSelection}>{t('清除选择')}<X size={13} aria-hidden /></button></> : <span>{t('选择一个主题，或用箭头继续浏览')}</span>}</div>
        </> : <div className="atlas-detail-empty"><ScatterChart size={28} strokeWidth={1.4} aria-hidden /><p>{t('搜索结果会在这里展开')}</p></div>}
      </aside>
    </div>
  </div>
}
