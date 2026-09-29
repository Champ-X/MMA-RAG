import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Check, Circle, LayoutList, Search, ScatterChart, X } from 'lucide-react'
import type { PortraitCluster } from './PortraitGraph'
import { layoutPortraitClusters } from './portraitAtlasLayout'
import { layoutPortraitWords } from './portraitWordCloud'
import './topicAtlas.css'

interface TopicAtlasProps {
  clusters: PortraitCluster[]
  selectedId: string | null
  onSelect: (cluster: PortraitCluster) => void
  onClear: () => void
}

// Ink colors stay legible on the softly tinted surfaces in both color schemes.
const COLORS = ['teal', 'blue', 'violet', 'amber', 'rose', 'sage'] as const
const CLOUD_FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif'

function keywordsFor(cluster: PortraitCluster) {
  const words = cluster.keywords?.length
    ? cluster.keywords
    : cluster.topic_summary.split(/[，。、；：！？\s]+/)
  return [...new Set(words.map(word => word.trim()).filter(Boolean))]
}

export function TopicAtlas({ clusters, selectedId, onSelect, onClear }: TopicAtlasProps) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [size, setSize] = useState({ width: 600, height: 400 })
  const mapRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const detailTitleRef = useRef<HTMLHeadingElement>(null)
  const panelId = useId()
  const hintId = useId()
  const topics = useMemo(() => [...clusters].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id)).map((cluster, index) => {
    const keywords = keywordsFor(cluster)
    return {
      ...cluster,
      title: keywords[0] || '未命名主题',
      keywords,
      color: COLORS[index % COLORS.length],
      count: Number.isFinite(cluster.cluster_size) ? Math.max(0, cluster.cluster_size) : 0,
    }
  }), [clusters])
  const total = topics.reduce((sum, topic) => sum + topic.count, 0)
  const search = query.trim().toLocaleLowerCase()
  const matches = topics.filter(topic => `${topic.title} ${topic.keywords.join(' ')}`.toLocaleLowerCase().includes(search))
  const matchedIds = new Set(matches.map(topic => topic.cluster_id))
  const selected = topics.find(topic => topic.cluster_id === selectedId)
  const activeId = topics.some(topic => topic.cluster_id === hoveredId) ? hoveredId : selected?.cluster_id
  const tabStopId = matches.some(topic => topic.cluster_id === focusedId) ? focusedId : matches[0]?.cluster_id
  const nodes = useMemo(() => layoutPortraitClusters(clusters, size.width, size.height), [clusters, size])
  const topicById = new Map(topics.map(topic => [topic.cluster_id, topic]))
  const measureCloudText = useMemo(() => {
    if (typeof document === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return undefined
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return undefined
    return (text: string, fontSize: number, weight: number) => {
      context.font = `${weight} ${fontSize}px ${CLOUD_FONT}`
      return context.measureText(text).width
    }
  }, [])
  const wordClouds = useMemo(() => new Map(nodes.map(node => {
    const topic = topics.find(item => item.cluster_id === node.id)!
    return [node.id, layoutPortraitWords(topic.keywords.length ? topic.keywords : [topic.title], node.r * 2, node.id, measureCloudText)]
  })), [nodes, topics, measureCloudText])

  useEffect(() => {
    const element = mapRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [view])

  function clearQuery() {
    setQuery('')
    setHoveredId(null)
    searchRef.current?.focus()
  }

  function changeView(nextView: 'map' | 'list') {
    setView(nextView)
    setHoveredId(null)
  }

  function clearSelection() {
    const previousId = selectedId
    onClear()
    requestAnimationFrame(() => {
      const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-topic-id]')
      Array.from(buttons ?? []).find(button => button.dataset.topicId === previousId && !button.disabled)?.focus()
    })
  }

  function selectFromIndex(topic: PortraitCluster) {
    onSelect(topic)
    requestAnimationFrame(() => detailTitleRef.current?.focus())
  }

  function selectTopic(topic: PortraitCluster) {
    onSelect(topic)
    if (selectedId !== topic.cluster_id && (rootRef.current?.clientWidth ?? 0) < 760) {
      requestAnimationFrame(() => detailTitleRef.current?.scrollIntoView({ block: 'nearest' }))
    }
  }

  function handleSpatialKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const directions = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']
    if (!directions.includes(event.key)) return
    const current = event.currentTarget.getBoundingClientRect()
    const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft'
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const candidates = Array.from(mapRef.current?.querySelectorAll<HTMLButtonElement>('button[data-topic-id]:not(:disabled)') ?? [])
      .filter(button => button !== event.currentTarget)
      .map(button => {
        const rect = button.getBoundingClientRect()
        const gap = horizontal
          ? forward ? rect.left - current.right : current.left - rect.right
          : forward ? rect.top - current.bottom : current.top - rect.bottom
        const overlaps = horizontal
          ? rect.bottom > current.top && rect.top < current.bottom
          : rect.right > current.left && rect.left < current.right
        const offset = horizontal
          ? Math.abs(rect.top + rect.height / 2 - current.top - current.height / 2)
          : Math.abs(rect.left + rect.width / 2 - current.left - current.width / 2)
        return { button, gap, overlaps, score: gap + 2 * offset }
      })
      .filter(candidate => candidate.gap >= -2)
      .sort((a, b) => Number(b.overlaps) - Number(a.overlaps) || a.score - b.score)
    if (!candidates[0]) return
    event.preventDefault()
    candidates[0].button.focus()
    candidates[0].button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="topic-atlas" ref={rootRef} onKeyDown={event => {
      if (event.key === 'Escape') {
        if (query) clearQuery()
        else if (selectedId) clearSelection()
      }
    }}>
      <div className="atlas-toolbar">
        <label className="atlas-search">
          <Search size={15} aria-hidden />
          <input
            ref={searchRef}
            aria-label="搜索主题或关键词"
            placeholder="搜索主题或关键词"
            value={query}
            onChange={event => { setQuery(event.target.value); setHoveredId(null); onClear() }}
          />
          {query && <button type="button" aria-label="清空主题搜索" onClick={clearQuery}><X size={14} aria-hidden /></button>}
        </label>
        <div className="atlas-view-switch" role="group" aria-label="主题展示方式">
          <button type="button" aria-pressed={view === 'map'} onClick={() => changeView('map')}><ScatterChart size={14} aria-hidden />星图</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}><LayoutList size={14} aria-hidden />列表</button>
        </div>
      </div>
      <div className="atlas-workspace">
        <div className="atlas-main">
          <div className="atlas-meta">
            <span className="atlas-eyebrow">主题分布</span>
            <span role="status">{search ? `${matches.length} / ${topics.length} 个匹配主题` : `${topics.length} 个主题 · ${total} 条素材`}</span>
          </div>
          {view === 'map' ? (
            <div ref={mapRef} className="atlas-map" role="group" aria-label="主题气泡图" aria-describedby={hintId}>
              {nodes.map(node => {
                const topic = topicById.get(node.id)!
                const matched = matchedIds.has(node.id)
                const diameter = node.r * 2
                return (
                  <button
                    key={node.id}
                    type="button"
                    data-topic-id={node.id}
                    data-color={topic.color}
                    className="atlas-bubble"
                    data-selected={selectedId === node.id}
                    data-muted={!matched || Boolean(activeId && activeId !== node.id)}
                    style={{ left: node.x, top: node.y, width: diameter, height: diameter } as CSSProperties}
                    disabled={!matched}
                    tabIndex={tabStopId === node.id ? 0 : -1}
                    aria-label={`查看主题：${topic.title}，${topic.count} 条素材${topic.keywords.length > 1 ? `，关键词 ${topic.keywords.slice(1, 4).join('、')}` : ''}`}
                    aria-pressed={selectedId === node.id}
                    aria-controls={panelId}
                    title={`${topic.title} · ${topic.count} 条素材\n${topic.keywords.slice(1, 4).join(' · ')}`}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onFocus={() => { setFocusedId(node.id); setHoveredId(node.id) }}
                    onBlur={() => setHoveredId(null)}
                    onKeyDown={handleSpatialKey}
                    onClick={() => selectTopic(topic)}
                  >
                    <svg className="atlas-word-cloud" viewBox={`0 0 ${diameter} ${diameter}`} aria-hidden="true" style={{ fontFamily: CLOUD_FONT }}>
                      {wordClouds.get(node.id)?.map(word => (
                        <text
                          key={word.text}
                          x={word.x}
                          y={word.y}
                          transform={`rotate(${word.rotation} ${word.x} ${word.y})`}
                          fontSize={word.fontSize}
                          fontWeight={word.weight}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className={word.primary ? 'atlas-cloud-primary' : 'atlas-cloud-word'}
                          data-search-match={Boolean(search && word.text.toLocaleLowerCase().includes(search))}
                        >{word.text}</text>
                      ))}
                    </svg>
                    {diameter >= 48 && <span className="atlas-bubble-count" aria-hidden="true" style={{ width: Math.min(diameter * 0.55, 80), fontSize: diameter < 96 ? 9 : 10 }}>
                      {selectedId === node.id && diameter >= 96 && <Check size={11} aria-hidden />}
                      <b>{topic.count}</b><span>{diameter < 96 ? '条' : '条素材'}</span>
                    </span>}
                  </button>
                )
              })}
              {matches.length === 0 && <div className="atlas-no-results"><Search size={24} aria-hidden /><strong>没有找到匹配主题</strong><span>试试其他关键词，或清空搜索查看全部。</span><button type="button" onClick={clearQuery}>清空搜索</button></div>}
            </div>
          ) : (
            <div className="atlas-topic-list" aria-label="主题列表">
              {matches.map(topic => (
                <button type="button" key={topic.cluster_id} data-topic-id={topic.cluster_id} data-color={topic.color} className="atlas-list-card" aria-pressed={selectedId === topic.cluster_id} aria-controls={panelId} onClick={() => selectTopic(topic)}>
                  <span className="atlas-topic-dot" />
                  <span className="atlas-list-copy"><strong>{topic.title}</strong><span>{topic.topic_summary || '该主题暂未生成摘要。'}</span><small>{topic.keywords.slice(1, 4).join(' · ')}</small></span>
                  <span className="atlas-list-count">{topic.count}<small>条素材</small></span>
                  <ArrowUpRight size={15} aria-hidden />
                </button>
              ))}
              {matches.length === 0 && <div className="atlas-no-results"><Search size={24} aria-hidden /><strong>没有找到匹配主题</strong><button type="button" onClick={clearQuery}>清空搜索</button></div>}
            </div>
          )}
          <div className="atlas-caption" id={hintId}><Circle size={13} aria-hidden /><span>{view === 'map' ? '圆面积表示素材数量' : '点击主题查看完整摘要'}</span><span className="atlas-keyboard-hint">{view === 'map' ? '方向键切换 · Enter 选择 · Esc 清除' : 'Tab 切换 · Enter 选择 · Esc 清除'}</span></div>
        </div>
        <aside className="atlas-detail" id={panelId} aria-label={selected ? '已选主题摘要' : '主题导览'}>
          {selected ? (
            <div className="atlas-selected-detail" data-color={selected.color}>
              <div className="atlas-detail-top"><span className="atlas-eyebrow">主题详情</span><button type="button" className="atlas-icon-button" onClick={clearSelection} aria-label="清除主题选择"><X size={16} aria-hidden /></button></div>
              <div className="atlas-detail-title"><span className="atlas-topic-dot" /><h3 ref={detailTitleRef} tabIndex={-1}>{selected.title}</h3></div>
              <div className="atlas-selection-stats"><strong>{selected.count}<span> 条素材</span></strong><span>占已归类素材 {total ? (selected.count / total * 100).toFixed(1) : 0}%</span></div>
              <div className="atlas-share-track" aria-hidden><span style={{ width: `${total ? selected.count / total * 100 : 0}%` }} /></div>
              <h4>主题摘要</h4>
              <p className="atlas-summary">{selected.topic_summary || '该主题暂未生成摘要。'}</p>
              {selected.keywords.length > 0 && <><h4>关键词</h4><div className="atlas-keywords">{selected.keywords.slice(0, 8).map(word => <span key={word}>{word}</span>)}</div></>}
              <button type="button" className="atlas-back" onClick={clearSelection}><ArrowLeft size={14} aria-hidden />返回全部主题</button>
            </div>
          ) : (
            <>
              <span className="atlas-eyebrow">主题导览</span>
              <h3>发现内容之间的脉络</h3>
              <p className="atlas-intro">选择一个主题，查看摘要与关键词。</p>
              <div className="atlas-topic-index" aria-label="按素材数量排列的主题">
                {[...matches].sort((a, b) => b.count - a.count).map(topic => (
                  <button type="button" key={topic.cluster_id} data-color={topic.color} onClick={() => selectFromIndex(topic)} aria-controls={panelId}>
                    <span className="atlas-topic-dot" />
                    <span className="atlas-index-copy"><strong>{topic.title}</strong><small>{topic.keywords.slice(1, 3).join(' · ') || '查看主题摘要'}</small></span>
                    <span className="atlas-index-count">{topic.count}</span><ArrowUpRight size={13} aria-hidden />
                  </button>
                ))}
                {matches.length === 0 && <p className="atlas-intro">暂无匹配主题</p>}
              </div>
              <p className="atlas-index-note">按素材数量排序 · 同名主题由关键词区分</p>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
