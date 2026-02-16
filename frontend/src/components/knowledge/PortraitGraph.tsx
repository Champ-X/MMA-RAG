import { useEffect, useState, useCallback, useRef } from 'react'
import * as d3 from 'd3'
import { motion } from 'framer-motion'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScatterChart, FileText, Image, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { knowledgeApi } from '@/services/api_client'

/** 用户指定五色：["#987284","#75b9be","#d0d6b5","#f9b5ac","#ee7674"]，弥散渐变由每色派生 */
const MESH_PALETTES = {
  c0: { fill: '#987284', centerLight: '#b8a0a8', mid: '#987284', edge: '#7a5c68', glowBorder: 'rgba(152,114,132,0.88)' },
  c1: { fill: '#75b9be', centerLight: '#9ec9cc', mid: '#75b9be', edge: '#5a969a', glowBorder: 'rgba(117,185,190,0.88)' },
  c2: { fill: '#d0d6b5', centerLight: '#e2e6cf', mid: '#d0d6b5', edge: '#a8ad8f', glowBorder: 'rgba(208,214,181,0.88)' },
  c3: { fill: '#f9b5ac', centerLight: '#fcd4cf', mid: '#f9b5ac', edge: '#e08a82', glowBorder: 'rgba(249,181,172,0.88)' },
  c4: { fill: '#ee7674', centerLight: '#f4a2a0', mid: '#ee7674', edge: '#c85c5a', glowBorder: 'rgba(238,118,116,0.88)' },
} as const

const MESH_TIER_IDS = ['c0', 'c1', 'c2', 'c3', 'c4'] as const

function getBubbleTierId(_heat: number, index: number): (typeof MESH_TIER_IDS)[number] {
  return MESH_TIER_IDS[index % MESH_TIER_IDS.length]
}

function getBubblePaletteByHeat(heat: number, index: number): (typeof MESH_PALETTES)[keyof typeof MESH_PALETTES] {
  return MESH_PALETTES[getBubbleTierId(heat, index)]
}

/** 词云字体：现代无衬线，兼顾中文与科技感 */
const WORD_CLOUD_FONT = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Open Sans", Roboto, sans-serif'

/** 从 topic_summary 提取关键词（用于气泡内词云，数量少而精以适配小气泡） */
function extractKeywords(summary: string, maxWords = 6): string[] {
  if (!summary?.trim()) return []
  const cleaned = summary.replace(/[，。、；：！？\s]+/g, ' ').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  return words.slice(0, maxWords)
}

export interface PortraitCluster {
  cluster_id: string
  topic_summary: string
  cluster_size: number
  /** 后端 jieba 提取的关键词云，有则优先展示；无则前端从 topic_summary 切分 */
  keywords?: string[]
}

interface PortraitGraphProps {
  knowledgeBaseId: string
  /** 文档类文件个数（有 text_chunk 的文件数） */
  documentCount?: number
  /** 文本块条数（chunk 数），用于比例条 */
  textCount?: number
  /** 图片条数，用于比例条 */
  imageCount?: number
  /** 选中簇时过滤下方列表 */
  onClusterSelect?: (clusterId: string | null) => void
  className?: string
}

export function PortraitGraph({
  knowledgeBaseId,
  documentCount = 0,
  textCount = 0,
  imageCount = 0,
  onClusterSelect,
  className,
}: PortraitGraphProps) {
  const [clusters, setClusters] = useState<PortraitCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 点击气泡后展示 topic_summary 的浮层；再次点击同一气泡或点击外部关闭 */
  const [summaryPopupNode, setSummaryPopupNode] = useState<{
    cluster: PortraitCluster
    clientX: number
    clientY: number
  } | null>(null)
  /** 悬停气泡：其他变淡、目标放大、显示关系连线 */
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const summaryPopoverRef = useRef<HTMLDivElement>(null)

  const fetchPortrait = useCallback(async () => {
    setLoading(true)
    setGenError(null)
    try {
      const res = await knowledgeApi.getKnowledgeBasePortrait(knowledgeBaseId)
      const raw = res as {
        clusters?: Array<{
          cluster_id?: string
          topic_summary?: string
          cluster_size?: number
          keywords?: string[]
        }>
        topics?: Array<{ id?: string; summary?: string; size?: number }>
      }
      const list: PortraitCluster[] = []
      if (Array.isArray(raw.clusters)) {
        raw.clusters.forEach((c) => {
          list.push({
            cluster_id: c.cluster_id ?? String(list.length),
            topic_summary: c.topic_summary ?? '',
            cluster_size: c.cluster_size ?? 0,
            keywords: Array.isArray(c.keywords) ? c.keywords : undefined,
          })
        })
      } else if (Array.isArray(raw.topics)) {
        raw.topics.forEach((t, i) => {
          list.push({
            cluster_id: t.id ?? String(i),
            topic_summary: t.summary ?? '',
            cluster_size: t.size ?? 0,
          })
        })
      }
      setClusters(list)
    } catch {
      setClusters([])
    } finally {
      setLoading(false)
    }
  }, [knowledgeBaseId])

  useEffect(() => {
    fetchPortrait()
  }, [fetchPortrait])

  /** 点击气泡外或摘要浮层外时关闭摘要浮层 */
  useEffect(() => {
    if (!summaryPopupNode) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        summaryPopoverRef.current?.contains(target) ||
        containerRef.current?.contains(target)
      )
        return
      setSummaryPopupNode(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [summaryPopupNode])

  const handleRegenerate = async () => {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await knowledgeApi.regenerateKnowledgeBasePortrait(knowledgeBaseId)
      if (res.status === 'triggered') {
        setGenError(null)
        setTimeout(() => fetchPortrait(), 20000)
      } else if (res.status === 'success') {
        await fetchPortrait()
      }
    } catch (e: any) {
      setGenError(e?.response?.data?.detail ?? e?.message ?? '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const maxSize = clusters.length ? Math.max(...clusters.map((c) => c.cluster_size), 1) : 1
  const minSize = clusters.length ? Math.min(...clusters.map((c) => c.cluster_size), maxSize) : 1

  /** 气泡半径：面积 ∝ cluster_size，半径 = sqrt(面积)，映射到 [minR, maxR]，略大以便更好展示主题关键词 */
  const MIN_R = 40
  const MAX_R = 88
  const scaleRadius = useCallback(
    (size: number) => {
      if (maxSize <= 0) return MIN_R
      const t = (size - minSize) / (maxSize - minSize || 1)
      const areaRatio = Math.min(1, Math.max(0, t) * 1.2)
      const r = MIN_R + Math.sqrt(areaRatio) * (MAX_R - MIN_R)
      return Math.round(r)
    },
    [maxSize, minSize]
  )

  /** 力导向布局节点位置 [x, y]，在容器尺寸确定后计算 */
  const [layoutReady, setLayoutReady] = useState(false)
  const [bubbleNodes, setBubbleNodes] = useState<Array<{ x: number; y: number; r: number; cluster: PortraitCluster; index: number }>>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const chartWidth = 680
  const chartHeight = 520

  useEffect(() => {
    if (clusters.length === 0) {
      setBubbleNodes([])
      setLayoutReady(true)
      return
    }
    const cx = chartWidth / 2
    const cy = chartHeight / 2
    const nodes = clusters.map((c, i) => ({
      id: c.cluster_id,
      x: cx + (Math.random() - 0.5) * 180,
      y: cy + (Math.random() - 0.5) * 160,
      r: scaleRadius(c.cluster_size),
      cluster: c,
      index: i,
    }))
    const sim = d3
      .forceSimulation(nodes as unknown as d3.SimulationNodeDatum[])
      .force('center', d3.forceCenter(cx, cy))
      .force(
        'collision',
        d3.forceCollide<d3.SimulationNodeDatum & { r: number }>().radius((d) => (d as { r: number }).r + 18)
      )
      .force('x', d3.forceX(cx).strength(0.05))
      .force('y', d3.forceY(cy).strength(0.05))
      .stop()
    for (let i = 0; i < 120; i++) sim.tick()
    setBubbleNodes(
      nodes.map((n) => ({
        x: (n as { x: number }).x,
        y: (n as { y: number }).y,
        r: n.r,
        cluster: n.cluster,
        index: n.index,
      }))
    )
    setLayoutReady(true)
  }, [clusters, scaleRadius])

  const total = textCount + imageCount
  const textPct = total ? (textCount / total) * 100 : 50
  const imagePct = total ? (imageCount / total) * 100 : 50

  /** 热度 0~1：按 cluster_size 归一化，用于逻辑色与视觉层级 */
  const heatByNode = useCallback(
    (size: number) => (maxSize <= minSize ? 1 : (size - minSize) / (maxSize - minSize)),
    [maxSize, minSize]
  )

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/15 dark:from-indigo-400/20 dark:to-fuchsia-400/20 border border-indigo-200/50 dark:border-indigo-500/30">
              <ScatterChart className="h-4 w-4 text-indigo-600 dark:text-indigo-400" strokeWidth={2.5} />
            </span>
            <span>知识库主题气泡图</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex h-80 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-muted-foreground">正在加载画像…</p>
              </div>
            </div>
          ) : clusters.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-base font-medium text-slate-700 dark:text-slate-200">暂无主题画像</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm text-center px-4">
                知识库需有足够数据（约 10 条以上文本/图片）才能生成主题聚类画像。
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={handleRegenerate}
                disabled={generating || (textCount + imageCount) < 5}
                className="gap-2"
              >
                {generating ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    生成中…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    生成画像
                  </>
                )}
              </Button>
              {(textCount + imageCount) < 5 && (
                <p className="text-xs text-amber-600">当前数据量较少，建议先上传更多文件</p>
              )}
              {genError && (
                <p className="text-xs text-destructive">{genError}</p>
              )}
            </div>
          ) : (
            <div ref={containerRef} className="relative min-h-[520px] w-full overflow-hidden rounded-xl border border-slate-200/40 dark:border-slate-700/50 portrait-chart-container">
              {/* 纯净模式：中心微光；深色模式：深蓝黑 */}
              <div
                className="absolute inset-0 z-0 rounded-[inherit] opacity-100 dark:opacity-0"
                style={{
                  background: 'radial-gradient(ellipse 90% 80% at 50% 50%, rgba(255,255,255,0.99) 0%, rgba(250,251,253,0.97) 45%, rgba(248,250,252,0.95) 100%)',
                }}
                aria-hidden
              />
              <div className="absolute inset-0 z-0 hidden rounded-[inherit] bg-[#0c1222] dark:block" aria-hidden />
              <svg
                width="100%"
                height={chartHeight}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="relative z-10 block"
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  {/* 弥散渐变：电光蓝/绿/暖/紫/灰蓝，玻璃拟态发光体 */}
                  {MESH_TIER_IDS.map((tierId) => {
                    const { fill, centerLight, mid, edge } = MESH_PALETTES[tierId]
                    return (
                      <radialGradient key={tierId} id={`bubble-grad-${tierId}`} cx="28%" cy="28%" r="78%">
                        <stop offset="0%" stopColor={centerLight} stopOpacity={0.94} />
                        <stop offset="35%" stopColor={fill} stopOpacity={0.9} />
                        <stop offset="65%" stopColor={mid} stopOpacity={0.84} />
                        <stop offset="100%" stopColor={edge} stopOpacity={0.74} />
                      </radialGradient>
                    )
                  })}
                  {/* 内阴影：玻璃拟态 */}
                  <filter id="bubble-inner-shadow" x="-30%" y="-30%" width="160%" height="160%">
                    <feOffset in="SourceAlpha" dx="2" dy="2" result="offset" />
                    <feGaussianBlur in="offset" stdDeviation="3" result="blur" />
                    <feFlood floodColor="rgb(0,0,0)" floodOpacity="0.14" result="shadowFill" />
                    <feComposite in="shadowFill" in2="blur" operator="in" result="shadowShape" />
                    <feComposite in="shadowShape" in2="SourceAlpha" operator="in" result="innerOnly" />
                    <feComposite in="SourceGraphic" in2="innerOnly" operator="over" result="comp" />
                  </filter>
                </defs>
                {/* 悬停时：从当前气泡到其他气泡的关系连线 */}
                {layoutReady && hoveredNodeId && (() => {
                  const hovered = bubbleNodes.find((n) => n.cluster.cluster_id === hoveredNodeId)
                  if (!hovered) return null
                  return (
                    <g className="pointer-events-none">
                      {bubbleNodes
                        .filter((n) => n.cluster.cluster_id !== hoveredNodeId)
                        .map((other) => (
                          <line
                            key={other.cluster.cluster_id}
                            x1={hovered.x}
                            y1={hovered.y}
                            x2={other.x}
                            y2={other.y}
                            stroke="currentColor"
                            strokeOpacity={0.2}
                            strokeWidth={1}
                            strokeDasharray="4 3"
                            className="text-slate-400 dark:text-slate-500"
                          />
                        ))}
                    </g>
                  )
                })()}
                {layoutReady &&
                  bubbleNodes.map((node) => {
                    const heat = heatByNode(node.cluster.cluster_size)
                    const tierId = getBubbleTierId(heat, node.index)
                    const palette = getBubblePaletteByHeat(heat, node.index)
                    const isSelected = node.cluster.cluster_id === selectedId
                    const isHovered = node.cluster.cluster_id === hoveredNodeId
                    const allKeywords = (node.cluster.keywords && node.cluster.keywords.length > 0)
                      ? node.cluster.keywords
                      : extractKeywords(node.cluster.topic_summary)
                    const maxWords = node.r < 50 ? 3 : node.r < 68 ? 5 : 8
                    const keywords = allKeywords.slice(0, maxWords)
                    const hasKeywords = keywords.length > 0
                    const baseFont = Math.max(10, Math.min(13, Math.round(node.r / 5)))
                    const isSummaryOpen = summaryPopupNode?.cluster.cluster_id === node.cluster.cluster_id
                    const bubbleOpacity = 0.78 + 0.2 * Math.min(1, (node.r - 40) / 48)
                    const opacityWhenOtherHovered = hoveredNodeId && !isHovered ? 0.35 : bubbleOpacity
                    return (
                      <g
                        key={node.cluster.cluster_id}
                        transform={`translate(${node.x},${node.y})`}
                        style={{ cursor: 'pointer', opacity: opacityWhenOtherHovered }}
                        tabIndex={-1}
                        role="button"
                        aria-pressed={isSelected}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHoveredNodeId(node.cluster.cluster_id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        onClick={(e) => {
                          if (isSummaryOpen) {
                            setSummaryPopupNode(null)
                            setSelectedId(null)
                            onClusterSelect?.(null)
                          } else {
                            setSummaryPopupNode({
                              cluster: node.cluster,
                              clientX: e.clientX,
                              clientY: e.clientY,
                            })
                            setSelectedId(node.cluster.cluster_id)
                            onClusterSelect?.(node.cluster.cluster_id)
                          }
                          requestAnimationFrame(() => (document.activeElement as HTMLElement)?.blur())
                        }}
                      >
                        <motion.g
                          animate={{
                            y: [0, 3, -2, 0],
                            x: [0, 1, -1, 0],
                          }}
                          transition={{
                            duration: 3.2 + (node.index % 5) * 0.4,
                            repeat: Infinity,
                            repeatType: 'reverse',
                          }}
                        >
                          <motion.circle
                            r={node.r}
                            fill={`url(#bubble-grad-${tierId})`}
                            filter="url(#bubble-inner-shadow)"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{
                              scale: isHovered ? 1.12 : 1,
                              opacity: 1,
                            }}
                            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 1.02 }}
                          />
                          {/* 动态呼吸发光边框 */}
                          <circle
                            r={node.r}
                            fill="none"
                            stroke={palette.glowBorder}
                            strokeWidth={1}
                            strokeOpacity={0.88}
                            className="bubble-breathe"
                          />
                          {isSelected && (
                            <circle
                              r={node.r + 6}
                              fill="none"
                              stroke={palette.glowBorder}
                              strokeWidth={2}
                              strokeOpacity={0.9}
                            />
                          )}
                          <foreignObject
                          x={-node.r + 4}
                          y={-node.r + 4}
                          width={Math.max(0, node.r * 2 - 8)}
                          height={Math.max(0, node.r * 2 - 8)}
                          className="pointer-events-none"
                        >
                          <div
                            className="relative h-full w-full overflow-hidden"
                            style={{ fontFamily: WORD_CLOUD_FONT }}
                          >
                            {hasKeywords ? (
                              <>
                                {/* 核心词：保持水平、纯白加粗，字号略小以留出视觉空间 */}
                                <span
                                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-bold text-white"
                                  style={{
                                    fontSize: Math.min(node.r * 0.28, baseFont * 1.85),
                                    maxWidth: `${Math.min(node.r * 1.6, 96)}px`,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    textShadow: '0 1px 3px rgba(0,0,0,0.2), 0 0 1px rgba(255,255,255,0.5)',
                                  }}
                                  title={keywords[0]}
                                >
                                  {keywords[0].length > 8 ? `${keywords[0].slice(0, 7)}…` : keywords[0]}
                                </span>
                                {/* 次要词：横向排列，浅色，环绕核心词 */}
                                {keywords.slice(1).map((word, wi) => {
                                  const n = keywords.length - 1
                                  const angle = (wi / Math.max(1, n)) * 2 * Math.PI + (node.index * 0.5)
                                  const radiusRatio = 0.52 + 0.35 * (wi / Math.max(1, n))
                                  const cx = node.r - 4
                                  const cy = node.r - 4
                                  const left = cx + cx * radiusRatio * Math.cos(angle)
                                  const top = cy + cy * radiusRatio * Math.sin(angle)
                                  const wordFontSize = Math.max(baseFont, baseFont + 1 - Math.floor(wi / 2))
                                  return (
                                    <span
                                      key={`${word}-${wi}`}
                                      className="absolute whitespace-nowrap font-medium text-white/85"
                                      style={{
                                        left: `${left}px`,
                                        top: `${top}px`,
                                        transform: 'translate(-50%, -50%)',
                                        fontSize: wordFontSize,
                                        maxWidth: `${Math.min(node.r * 1.1, 64)}px`,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        textShadow: '0 0 1px rgba(0,0,0,0.15)',
                                      }}
                                      title={word}
                                    >
                                      {word.length > 5 ? `${word.slice(0, 4)}…` : word}
                                    </span>
                                  )
                                })}
                              </>
                            ) : (
                              <span
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-medium text-slate-500 dark:text-slate-400"
                                style={{ fontSize: baseFont }}
                              >
                                主题 {node.index + 1}
                              </span>
                            )}
                          </div>
                        </foreignObject>
                        </motion.g>
                      </g>
                    )
                  })}
              </svg>
            </div>
          )}

          {/* 点击气泡后展示 topic_summary 的浮层（再次点击同一气泡或点击外部关闭） */}
          {summaryPopupNode && (() => {
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
            const vh = typeof window !== 'undefined' ? window.innerHeight : 800
            const pad = 16
            const boxW = 400
            const maxH = 280
            let left = summaryPopupNode.clientX + 16
            let top = summaryPopupNode.clientY + 12
            if (left + boxW > vw - pad) left = vw - boxW - pad
            if (left < pad) left = pad
            if (top + maxH > vh - pad) top = vh - maxH - pad
            if (top < pad) top = pad
            return (
              <motion.div
                ref={summaryPopoverRef}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15 }}
                className="fixed z-50 w-[400px] max-h-[280px] overflow-hidden rounded-xl border border-slate-200/90 bg-white/98 shadow-xl backdrop-blur-sm dark:border-slate-600/90 dark:bg-slate-900/98"
                style={{ left, top }}
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      主题摘要
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {summaryPopupNode.cluster.cluster_size} 条
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    aria-label="关闭"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSummaryPopupNode(null)
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="max-h-[220px] overflow-y-auto px-4 py-3">
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                    {summaryPopupNode.cluster.topic_summary || '暂无摘要'}
                  </p>
                </div>
              </motion.div>
            )
          })()}

          {clusters.length > 0 && (
            <p className="text-xs text-muted-foreground">
              气泡内为主题关键词；点击气泡可查看主题摘要并筛选该簇文档，再次点击同一气泡或点击空白处关闭摘要；气泡大小表示 cluster_size。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 数据源比例条 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据源比例</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex h-8 overflow-hidden rounded-lg bg-muted">
              <div
                className="flex items-center justify-center gap-2 bg-blue-500/80 text-white transition-all"
                style={{ width: `${textPct}%` }}
              >
                <FileText className="h-4 w-4" />
                <span className="text-sm font-medium">Text</span>
              </div>
              <div
                className="flex items-center justify-center gap-2 bg-violet-500/80 text-white transition-all"
                style={{ width: `${imagePct}%` }}
              >
                <Image className="h-4 w-4" />
                <span className="text-sm font-medium">Image</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Text {textCount} ({textPct.toFixed(0)}%)
              </span>
              <span>
                Image {imageCount} ({imagePct.toFixed(0)}%)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 主题统计 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">主题统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {clusters.length}
              </div>
              <div className="text-sm text-muted-foreground">主题数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {documentCount}
              </div>
              <div className="text-sm text-muted-foreground">文档数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {textCount}
              </div>
              <div className="text-sm text-muted-foreground">文本块</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-violet-600">
                {imageCount}
              </div>
              <div className="text-sm text-muted-foreground">图片</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedId && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">已选: {selectedId}</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedId(null)
              onClusterSelect?.(null)
            }}
          >
            清除筛选
          </Button>
        </div>
      )}
    </div>
  )
}
