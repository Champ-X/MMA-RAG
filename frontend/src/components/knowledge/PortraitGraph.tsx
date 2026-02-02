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
import { Info, FileText, Image, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { knowledgeApi } from '@/services/api_client'

/** 莫兰迪色系：浅填充 + 同色系深色边框（[fill, border]） */
const MORANDI_PALETTE: [string, string][] = [
  ['#A8B5C4', '#7A8FA3'],
  ['#9CB5A8', '#6B8F7A'],
  ['#C4B89C', '#9A8A6B'],
  ['#C4A8A8', '#9A7A7A'],
  ['#B8A8C4', '#8A7A9A'],
  ['#A8C4C4', '#7A9A9A'],
  ['#C4B098', '#9A7A5C'],
  ['#C4A8B8', '#9A7A8A'],
  ['#B0B8C4', '#7A829A'],
  ['#B8C4A8', '#8A9A7A'],
]

/** 从 topic_summary 提取简短关键词（用于悬停展示） */
function extractKeywords(summary: string, maxWords = 10): string[] {
  if (!summary?.trim()) return []
  const cleaned = summary.replace(/[，。、；：！？\s]+/g, ' ').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  return words.slice(0, maxWords)
}

export interface PortraitCluster {
  cluster_id: string
  topic_summary: string
  cluster_size: number
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

  /** 气泡半径：面积 ∝ cluster_size，半径 = sqrt(面积)，映射到 [minR, maxR] */
  const MIN_R = 32
  const MAX_R = 72
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
  const chartWidth = 640
  const chartHeight = 420

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
      x: cx + (Math.random() - 0.5) * 120,
      y: cy + (Math.random() - 0.5) * 100,
      r: scaleRadius(c.cluster_size),
      cluster: c,
      index: i,
    }))
    const sim = d3
      .forceSimulation(nodes as unknown as d3.SimulationNodeDatum[])
      .force('center', d3.forceCenter(cx, cy))
      .force(
        'collision',
        d3.forceCollide<d3.SimulationNodeDatum & { r: number }>().radius((d) => (d as { r: number }).r + 8)
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

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            知识库画像 · 主题气泡图
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
            <div
              ref={containerRef}
              className="relative min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-700/80"
              style={{
                background:
                  'linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)',
                backgroundSize: '20px 20px',
                backgroundColor: 'hsl(var(--muted) / 0.35)',
              }}
            >
              <svg
                width="100%"
                height={chartHeight}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="block"
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  {MORANDI_PALETTE.map(([fill], i) => (
                    <radialGradient key={i} id={`bubble-grad-${i}`} cx="35%" cy="35%" r="65%">
                      <stop offset="0%" stopColor={fill} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={fill} stopOpacity={0.75} />
                    </radialGradient>
                  ))}
                </defs>
                {layoutReady &&
                  bubbleNodes.map((node) => {
                    const border = MORANDI_PALETTE[node.index % MORANDI_PALETTE.length][1]
                    const isSelected = node.cluster.cluster_id === selectedId
                    const keywordTip =
                      extractKeywords(node.cluster.topic_summary).join(' · ') ||
                      node.cluster.topic_summary?.slice(0, 80) ||
                      ''
                    return (
                      <g
                        key={node.cluster.cluster_id}
                        transform={`translate(${node.x},${node.y})`}
                        style={{ cursor: 'pointer' }}
                        tabIndex={-1}
                        role="button"
                        aria-pressed={isSelected}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const next = isSelected ? null : node.cluster.cluster_id
                          setSelectedId(next)
                          onClusterSelect?.(next ?? null)
                          requestAnimationFrame(() => (document.activeElement as HTMLElement)?.blur())
                        }}
                      >
                        <title>关键词：{keywordTip}</title>
                        {/* 选中态：同色系圆环，替代浏览器默认的矩形焦点框 */}
                        {isSelected && (
                          <circle
                            r={node.r + 5}
                            fill="none"
                            stroke={border}
                            strokeWidth={2.5}
                            strokeOpacity={0.85}
                          />
                        )}
                        <motion.circle
                          r={node.r}
                          fill={`url(#bubble-grad-${node.index % MORANDI_PALETTE.length})`}
                          stroke={border}
                          strokeWidth={1.5}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                          whileHover={{ scale: 1.08 }}
                          whileTap={{ scale: 1.02 }}
                          style={{
                            filter: isSelected
                              ? `drop-shadow(0 0 12px ${border}88)`
                              : 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))',
                          }}
                        />
                        <foreignObject
                          x={-node.r + 6}
                          y={-node.r + 6}
                          width={Math.max(0, node.r * 2 - 12)}
                          height={Math.max(0, node.r * 2 - 12)}
                          className="pointer-events-none"
                        >
                          <div className="flex h-full w-full items-center justify-center text-center">
                            <span
                              className="line-clamp-3 text-xs font-medium leading-tight text-slate-700 dark:text-slate-200"
                              style={{ fontSize: Math.max(10, Math.min(12, node.r / 5)) }}
                            >
                              {node.cluster.topic_summary || `主题 ${node.index + 1}`}
                            </span>
                          </div>
                        </foreignObject>
                      </g>
                    )
                  })}
              </svg>
            </div>
          )}
          {clusters.length > 0 && (
            <p className="text-xs text-muted-foreground">
              点击气泡可筛选该簇下的文档；气泡大小表示 cluster_size。
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
