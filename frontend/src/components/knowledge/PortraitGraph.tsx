import { useEffect, useState, useCallback, useRef } from 'react'
import * as d3 from 'd3'
import { motion } from 'framer-motion'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScatterChart, FileText, Image, Music, Video, RefreshCw, LayoutList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { knowledgeApi } from '@/services/api_client'

/** 柔和同系色阶：indigo → violet → fuchsia 降饱和、提明度，过渡平滑不跳色 */
const MESH_PALETTES = {
  c0: { fill: '#a5b4fc', centerLight: '#e0e7ff', mid: '#818cf8', edge: '#6366f1', glowBorder: 'rgba(99,102,241,0.52)' },
  c1: { fill: '#b8a9f8', centerLight: '#e8e4ff', mid: '#a78bfa', edge: '#7c3aed', glowBorder: 'rgba(124,58,237,0.5)' },
  c2: { fill: '#c4b5fd', centerLight: '#ede9fe', mid: '#a78bfa', edge: '#8b5cf6', glowBorder: 'rgba(139,92,246,0.5)' },
  c3: { fill: '#d4b8fc', centerLight: '#f3e8ff', mid: '#c084fc', edge: '#a855f7', glowBorder: 'rgba(168,85,247,0.5)' },
  c4: { fill: '#e9b8fc', centerLight: '#fae8ff', mid: '#e879f9', edge: '#d946ef', glowBorder: 'rgba(217,70,239,0.5)' },
  c5: { fill: '#f0c6fc', centerLight: '#fdf4ff', mid: '#f0abfc', edge: '#e879f9', glowBorder: 'rgba(232,121,249,0.5)' },
  c6: { fill: '#f5d0fe', centerLight: '#fdf4ff', mid: '#f5d0fe', edge: '#e879f9', glowBorder: 'rgba(232,121,249,0.48)' },
} as const

const MESH_TIER_IDS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const

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
  /** 音频条数（参与画像与数据量判断） */
  audioCount?: number
  /** 视频条数（参与数据源比例与主题统计） */
  videoCount?: number
  /** 选中簇时过滤下方列表 */
  onClusterSelect?: (clusterId: string | null) => void
  className?: string
}

const PORTRAIT_DATA_THRESHOLD = 10

export function PortraitGraph({
  knowledgeBaseId,
  documentCount = 0,
  textCount = 0,
  imageCount = 0,
  audioCount = 0,
  videoCount = 0,
  onClusterSelect,
  className,
}: PortraitGraphProps) {
  const totalDataCount = textCount + imageCount + audioCount + videoCount
  const [clusters, setClusters] = useState<PortraitCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pollingIntervalRef = useRef<number | null>(null)
  const pollingTimeoutRef = useRef<number | null>(null)
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

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current)
        pollingTimeoutRef.current = null
      }
    }
  }, [])

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
    // 清理之前的轮询
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current)
      pollingTimeoutRef.current = null
    }

    // 记录生成前的数据状态，用于判断数据是否真的更新了
    const previousClustersHash = clusters.length > 0 
      ? clusters.map(c => `${c.cluster_id}-${c.cluster_size}-${c.topic_summary?.slice(0, 50)}`).join('|')
      : ''

    setGenerating(true)
    setGenError(null)
    try {
      const res = await knowledgeApi.regenerateKnowledgeBasePortrait(knowledgeBaseId)
      if (res.status === 'triggered') {
        // 异步任务已启动，开始轮询检查
        setGenError(null)
        
        // 设置最大轮询时间（3分钟）
        pollingTimeoutRef.current = setTimeout(() => {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
            pollingIntervalRef.current = null
          }
          setGenerating(false)
          setGenError('生成超时，请稍后手动刷新查看结果')
        }, 180000) // 3分钟超时

        // 轮询检查函数（静默检查，不设置 loading 状态）
        const checkPortraitStatus = async () => {
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
            
            // 检查数据是否真的更新了（通过比较数据哈希）
            const currentClustersHash = list.length > 0
              ? list.map(c => `${c.cluster_id}-${c.cluster_size}-${c.topic_summary?.slice(0, 50)}`).join('|')
              : ''
            
            // 只有当数据发生变化时才停止轮询（避免检测到旧数据立即停止）
            const dataChanged = currentClustersHash !== previousClustersHash
            
            if (list.length > 0 && dataChanged) {
              // 先停止轮询和超时
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current)
                pollingIntervalRef.current = null
              }
              if (pollingTimeoutRef.current) {
                clearTimeout(pollingTimeoutRef.current)
                pollingTimeoutRef.current = null
              }
              // 使用 fetchPortrait 确保状态一致更新
              setGenerating(false)
              await fetchPortrait()
            } else if (list.length > 0 && !dataChanged) {
              // 数据还没更新，继续轮询（不停止）
              // 这种情况发生在重新生成时，旧数据还在，需要等待新数据生成
            }
          } catch (err) {
            // 轮询时出错，继续轮询（不停止）
            console.error('轮询检查画像状态失败:', err)
          }
        }

        // 等待一段时间后再开始检查，给后端一些时间开始生成
        // 避免立即检测到旧数据
        setTimeout(async () => {
          // 检查是否还在生成中（通过检查 ref 是否还存在）
          if (pollingTimeoutRef.current) {
            await checkPortraitStatus()
            // 如果还在生成中（超时定时器还在），开始定期轮询（每5秒检查一次）
            if (pollingTimeoutRef.current && !pollingIntervalRef.current) {
              pollingIntervalRef.current = setInterval(checkPortraitStatus, 5000)
            }
          }
        }, 3000) // 等待3秒后再开始检查
      } else if (res.status === 'success') {
        // 同步生成完成，直接刷新
        await fetchPortrait()
        setGenerating(false)
      }
    } catch (e: any) {
      setGenError(e?.response?.data?.detail ?? e?.message ?? '生成失败')
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

  const total = textCount + imageCount + audioCount + videoCount
  const textPct = total ? (textCount / total) * 100 : 25
  const imagePct = total ? (imageCount / total) * 100 : 25
  const audioPct = total ? (audioCount / total) * 100 : 25
  const videoPct = total ? (videoCount / total) * 100 : 25

  /** 热度 0~1：按 cluster_size 归一化，用于逻辑色与视觉层级 */
  const heatByNode = useCallback(
    (size: number) => (maxSize <= minSize ? 1 : (size - minSize) / (maxSize - minSize)),
    [maxSize, minSize]
  )

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/15 dark:from-indigo-400/20 dark:to-fuchsia-400/20 border border-indigo-200/50 dark:border-indigo-500/30">
                <ScatterChart className="h-4 w-4 text-indigo-600 dark:text-indigo-400" strokeWidth={2.5} />
              </span>
              <span>知识库主题气泡图</span>
            </CardTitle>
            {clusters.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={generating}
                className="group gap-2 rounded-xl border-indigo-200/50 bg-gradient-to-r from-indigo-50/50 to-fuchsia-50/50 text-indigo-700 shadow-sm transition-all duration-200 hover:border-indigo-300/70 hover:from-indigo-100/70 hover:to-fuchsia-100/70 hover:shadow-md hover:shadow-indigo-500/10 dark:border-indigo-500/25 dark:from-indigo-950/40 dark:to-fuchsia-950/40 dark:text-indigo-300 dark:hover:border-indigo-400/40 dark:hover:from-indigo-900/50 dark:hover:to-fuchsia-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full bg-indigo-200/40 dark:bg-indigo-800/20 blur-sm animate-pulse" />
                      <RefreshCw className="relative h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <span className="font-medium">生成中…</span>
                  </>
                ) : (
                  <>
                    <div className="relative">
                      {/* 悬停时的光晕效果 */}
                      <div className="absolute inset-0 -m-0.5 rounded-full bg-gradient-to-br from-indigo-200/0 to-fuchsia-200/0 group-hover:from-indigo-200/50 group-hover:to-fuchsia-200/50 dark:group-hover:from-indigo-800/30 dark:group-hover:to-fuchsia-800/30 blur-md transition-all duration-300" />
                      {/* 图标 */}
                      <RefreshCw className="relative h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 transition-all duration-300 group-hover:rotate-180 group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-400" />
                    </div>
                    <span className="font-medium">重新生成</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex h-80 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-fuchsia-400 dark:border-indigo-500 dark:border-t-fuchsia-500" />
                <p className="text-muted-foreground">正在加载画像…</p>
              </div>
            </div>
          ) : clusters.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-gradient-to-br from-indigo-50/40 via-transparent to-fuchsia-50/40 dark:from-indigo-950/30 dark:via-transparent dark:to-fuchsia-950/30">
              {generating ? (
                <>
                  <div className="relative">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-indigo-800 dark:border-t-indigo-400" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ScatterChart className="h-6 w-6 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-base font-medium text-slate-700 dark:text-slate-200">正在生成主题画像</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm px-4">
                      正在分析知识库内容并生成主题聚类，请稍候…
                    </p>
                    <div className="flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100/80 dark:bg-indigo-900/40 text-indigo-500 dark:text-indigo-400">
                    <ScatterChart className="h-6 w-6" strokeWidth={2} />
                  </span>
                  <p className="text-base font-medium text-slate-700 dark:text-slate-200 mt-2">暂无主题画像</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm text-center px-4">
                    知识库需有足够数据（约 10 条以上文本/图片/音频/视频关键帧）才能生成主题聚类画像。
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={generating || totalDataCount < PORTRAIT_DATA_THRESHOLD}
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
                  {totalDataCount < PORTRAIT_DATA_THRESHOLD && (
                    <p className="text-xs text-amber-600">当前数据量较少，建议先上传更多文件（需至少约 10 条）</p>
                  )}
                  {genError && (
                    <p className="text-xs text-destructive">{genError}</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div ref={containerRef} className="relative min-h-[520px] w-full overflow-hidden rounded-xl border border-slate-200/40 dark:border-slate-700/50 portrait-chart-container">
              {/* 生成中的遮罩层 */}
              {generating && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-[100] flex items-center justify-center rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md"
                >
                  <div className="text-center space-y-4">
                    <div className="relative mx-auto" style={{ width: '64px', height: '64px' }}>
                      <div className="absolute inset-0 animate-spin rounded-full border-4 border-fuchsia-200 border-t-fuchsia-600 dark:border-fuchsia-800 dark:border-t-fuchsia-400" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <ScatterChart className="h-6 w-6 text-fuchsia-600 dark:text-fuchsia-400" strokeWidth={2} />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-base font-medium text-slate-700 dark:text-slate-200">正在更新画像</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm px-4">
                        正在分析知识库内容并重新生成主题聚类，请稍候…
                      </p>
                      <div className="flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                        <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" />
                        <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                        <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
              {/* 亮色：径向渐变 + 极淡 indigo/fuchsia 中心光晕；暗色：带蓝深色 + 极弱径向景深 */}
              <div
                className="absolute inset-0 z-0 rounded-[inherit] opacity-100 dark:opacity-0"
                style={{
                  background: 'radial-gradient(ellipse 90% 80% at 50% 50%, rgba(255,255,255,0.99) 0%, rgba(250,251,253,0.97) 45%, rgba(248,250,252,0.95) 100%), radial-gradient(ellipse 75% 65% at 50% 50%, rgba(224,231,255,0.25) 0%, rgba(129,140,248,0.08) 35%, rgba(217,70,239,0.05) 60%, transparent 100%)',
                }}
                aria-hidden
              />
              <div
                className="absolute inset-0 z-0 hidden rounded-[inherit] dark:block"
                style={{
                  background: 'radial-gradient(ellipse 85% 75% at 50% 50%, rgba(15,23,42,0.97) 0%, #0f172a 60%, #0c1222 100%), radial-gradient(ellipse 50% 50% at 50% 50%, rgba(99,102,241,0.04) 0%, transparent 70%)',
                }}
                aria-hidden
              />
              <svg
                width="100%"
                height={chartHeight}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="relative z-10 block"
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  {/* 柔和弥散渐变：中心更亮、边缘过渡更顺，整体偏 pastel */}
                  {MESH_TIER_IDS.map((tierId) => {
                    const { fill, centerLight, mid, edge } = MESH_PALETTES[tierId]
                    return (
                      <radialGradient key={tierId} id={`bubble-grad-${tierId}`} cx="30%" cy="30%" r="75%">
                        <stop offset="0%" stopColor={centerLight} stopOpacity={0.92} />
                        <stop offset="25%" stopColor={centerLight} stopOpacity={0.88} />
                        <stop offset="50%" stopColor={fill} stopOpacity={0.82} />
                        <stop offset="78%" stopColor={mid} stopOpacity={0.76} />
                        <stop offset="100%" stopColor={edge} stopOpacity={0.68} />
                      </radialGradient>
                    )
                  })}
                  {/* 内阴影：轻微玻璃感，不抢色 */}
                  <filter id="bubble-inner-shadow" x="-30%" y="-30%" width="160%" height="160%">
                    <feOffset in="SourceAlpha" dx="1.5" dy="1.5" result="offset" />
                    <feGaussianBlur in="offset" stdDeviation="2.2" result="blur" />
                    <feFlood floodColor="rgb(0,0,0)" floodOpacity="0.08" result="shadowFill" />
                    <feComposite in="shadowFill" in2="blur" operator="in" result="shadowShape" />
                    <feComposite in="shadowShape" in2="SourceAlpha" operator="in" result="innerOnly" />
                    <feComposite in="SourceGraphic" in2="innerOnly" operator="over" result="comp" />
                  </filter>
                  {/* 选中态：主色外发光（模糊描边 + 半透明 indigo/fuchsia） */}
                  <filter id="bubble-selected-glow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                    <feFlood floodColor="#6366f1" floodOpacity="0.45" result="fill" />
                    <feComposite in="fill" in2="blur" operator="in" result="glow" />
                    <feMerge>
                      <feMergeNode in="glow" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
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
                            stroke="#6366f1"
                            strokeOpacity={0.42}
                            strokeWidth={1.2}
                            strokeDasharray="5 4"
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
                    const maxWords = node.r < 50 ? 2 : node.r < 68 ? 4 : 6
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
                            y: [0, 1.2, -0.8, 0],
                            x: [0, 0.6, -0.5, 0],
                          }}
                          transition={{
                            duration: 5.2 + (node.index % 4) * 0.5,
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
                            strokeOpacity={0.58}
                            className="bubble-breathe"
                          />
                          {isSelected && (
                            <g filter="url(#bubble-selected-glow)">
                              <circle
                                r={node.r + 6}
                                fill="none"
                                stroke="#6366f1"
                                strokeWidth={2.5}
                                strokeOpacity={0.95}
                              />
                            </g>
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
                                    textShadow: '0 0 1px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,0.3), 0 0 1px rgba(255,255,255,0.4)',
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
                                        textShadow: '0 0 1px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.35)',
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
                    <span className="rounded-md bg-gradient-to-r from-indigo-100 to-fuchsia-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:from-indigo-900/40 dark:to-fuchsia-900/40 dark:text-indigo-200">
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
            <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-br from-slate-50/50 to-indigo-50/30 dark:from-slate-800/30 dark:to-indigo-950/20 px-3 py-2">
              <div className="flex items-center gap-2.5">
                <div className="flex-shrink-0">
                  <div className="rounded-md bg-indigo-100/80 dark:bg-indigo-900/40 p-1.5">
                    <ScatterChart className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                  </div>
                </div>
                <p className="flex-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">气泡内为主题关键词</span>
                  <span className="text-slate-300 dark:text-slate-600 mx-2.5">•</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">点击气泡查看主题摘要并筛选文档</span>
                  <span className="text-slate-300 dark:text-slate-600 mx-2.5">•</span>
                  <span className="font-medium text-fuchsia-700 dark:text-fuchsia-300">气泡大小表示文档数量</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 数据源比例条 */}
      <Card className="overflow-hidden border-slate-200/60 dark:border-slate-700/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">数据源比例</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-10 overflow-hidden rounded-xl bg-slate-100/90 dark:bg-slate-800/50 shadow-inner">
            <div
              className="flex items-center justify-center gap-2 rounded-l-xl bg-gradient-to-r from-indigo-400 via-indigo-500 to-indigo-600 text-white shadow-sm transition-all duration-300 min-w-0"
              style={{ width: `${textPct}%` }}
            >
              <FileText className="h-4 w-4 flex-shrink-0 opacity-95" />
              <span className="text-sm font-medium truncate">Text</span>
            </div>
            <div
              className={cn(
                "flex items-center justify-center gap-2 bg-gradient-to-r from-fuchsia-400 via-fuchsia-500 to-fuchsia-600 text-white shadow-sm transition-all duration-300 min-w-0",
                audioCount === 0 && videoCount === 0 && "rounded-r-xl"
              )}
              style={{ width: `${imagePct}%` }}
            >
              <Image className="h-4 w-4 flex-shrink-0 opacity-95" />
              <span className="text-sm font-medium truncate">Image</span>
            </div>
            {audioCount > 0 && (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-white shadow-sm transition-all duration-300 min-w-0",
                  videoCount === 0 && "rounded-r-xl"
                )}
                style={{ width: `${audioPct}%` }}
              >
                <Music className="h-4 w-4 flex-shrink-0 opacity-95" />
                <span className="text-sm font-medium truncate">Audio</span>
              </div>
            )}
            {videoCount > 0 && (
              <div
                className="flex items-center justify-center gap-2 rounded-r-xl bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 text-white shadow-sm transition-all duration-300 min-w-0"
                style={{ width: `${videoPct}%` }}
              >
                <Video className="h-4 w-4 flex-shrink-0 opacity-95" />
                <span className="text-sm font-medium truncate">Video</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-medium">Text {textCount} <span className="text-slate-400 dark:text-slate-500">({textPct.toFixed(0)}%)</span></span>
            <span className="font-medium">Image {imageCount} <span className="text-slate-400 dark:text-slate-500">({imagePct.toFixed(0)}%)</span></span>
            {audioCount > 0 && (
              <span className="font-medium">Audio {audioCount} <span className="text-slate-400 dark:text-slate-500">({audioPct.toFixed(0)}%)</span></span>
            )}
            {videoCount > 0 && (
              <span className="font-medium">Video {videoCount} <span className="text-slate-400 dark:text-slate-500">({videoPct.toFixed(0)}%)</span></span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 主题统计 */}
      <Card className="overflow-hidden border-slate-200/60 dark:border-slate-700/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">主题统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded-xl bg-gradient-to-br from-indigo-50/90 to-indigo-100/50 dark:from-indigo-950/40 dark:to-indigo-900/20 border border-indigo-100/80 dark:border-indigo-800/40 px-4 py-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {clusters.length}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-indigo-700/80 dark:text-indigo-300/90">
                <ScatterChart className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                <span>主题数</span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 px-4 py-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-slate-600 dark:text-slate-300">
                {documentCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <FileText className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                <span>文档数</span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 px-4 py-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-slate-600 dark:text-slate-300">
                {textCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <LayoutList className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                <span>文本块</span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-fuchsia-50/90 to-fuchsia-100/50 dark:from-fuchsia-950/40 dark:to-fuchsia-900/20 border border-fuchsia-100/80 dark:border-fuchsia-800/40 px-4 py-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-fuchsia-600 dark:text-fuchsia-400">
                {imageCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-fuchsia-700/80 dark:text-fuchsia-300/90">
                <Image className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                <span>图片</span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-50/90 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20 border border-amber-100/80 dark:border-amber-800/40 px-4 py-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {audioCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-amber-700/80 dark:text-amber-300/90">
                <Music className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                <span>音频</span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border border-emerald-100/80 dark:border-emerald-800/40 px-4 py-3 text-center">
              <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {videoCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-emerald-700/80 dark:text-emerald-300/90">
                <Video className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                <span>视频</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
