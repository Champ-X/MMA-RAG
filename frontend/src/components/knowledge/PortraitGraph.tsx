import { useEffect, useState, useCallback, useId, useRef } from 'react'
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
import { BUBBLE_THEME_TIER_COUNT, BUBBLE_THEMES } from './portraitBubbleThemes'

/** 词云字体：现代无衬线，兼顾中文与科技感 */
const WORD_CLOUD_FONT = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Open Sans", Roboto, sans-serif'

/** 画像保持一套稳定的星图配色，避免每次刷新让用户重新建立视觉记忆。 */
const ATLAS_BUBBLE_THEME = BUBBLE_THEMES.find((theme) => theme.id === 'ui-code') ?? BUBBLE_THEMES[0]!

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
  /** 视频 Shot 条数（参与画像的数据源比例与主题统计）；与用户可见的视频文件数分离。 */
  videoShotCount?: number
  /** 选中簇时过滤下方列表 */
  onClusterSelect?: (clusterId: string | null) => void
  className?: string
}

// 后端已支持小语料生成单主题画像；前端只在完全没有可用语义样本时禁用。
const PORTRAIT_DATA_THRESHOLD = 1

function getPortraitErrorMessage(error: unknown) {
  if (typeof error === 'object' && error != null && 'response' in error) {
    const response = error.response
    if (typeof response === 'object' && response != null && 'data' in response) {
      const data = response.data
      if (typeof data === 'object' && data != null && 'detail' in data && typeof data.detail === 'string') {
        return data.detail
      }
    }
  }
  if (typeof error === 'object' && error != null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message) return message
  }
  return '生成失败'
}

export function PortraitGraph({
  knowledgeBaseId,
  documentCount = 0,
  textCount = 0,
  imageCount = 0,
  audioCount = 0,
  videoShotCount = 0,
  onClusterSelect,
  className,
}: PortraitGraphProps) {
  const totalDataCount = textCount + imageCount + audioCount + videoShotCount
  const [clusters, setClusters] = useState<PortraitCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pollingIntervalRef = useRef<number | null>(null)
  const pollingTimeoutRef = useRef<number | null>(null)
  /** 悬停气泡：其他变淡、目标放大、显示关系连线 */
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const portraitId = useId().replace(/:/g, '')
  const chartSummaryId = `${portraitId}-portrait-summary`
  const chartRegionId = `${portraitId}-portrait-chart`
  const bubbleTheme = ATLAS_BUBBLE_THEME

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

  useEffect(() => {
    setSelectedId(null)
    setHoveredNodeId(null)
  }, [knowledgeBaseId])

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
    } catch (e: unknown) {
      setGenError(getPortraitErrorMessage(e))
      setGenerating(false)
    }
  }

  const maxSize = clusters.length ? Math.max(...clusters.map((c) => c.cluster_size), 1) : 1
  const minSize = clusters.length ? Math.min(...clusters.map((c) => c.cluster_size), maxSize) : 1

  /** 气泡面积与主题内容数量成正比；少量主题时放大，形成更有呼吸感的主视觉。 */
  const MIN_R = clusters.length <= 3 ? 72 : clusters.length <= 6 ? 58 : 46
  const MAX_R = clusters.length <= 3 ? 120 : clusters.length <= 6 ? 96 : 78
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
    setLayoutReady(false)
    const cx = chartWidth / 2
    const cy = chartHeight / 2
    const clusterCount = clusters.length
    const orbitRadius = clusterCount === 1 ? 0 : clusterCount === 2 ? 134 : Math.min(205, 118 + clusterCount * 10)
    const nodes = clusters.map((c, i) => ({
      id: c.cluster_id,
      x: cx + Math.cos(clusterCount === 2 ? i * Math.PI : -Math.PI / 2 + (i / clusterCount) * Math.PI * 2) * orbitRadius,
      y: cy + Math.sin(clusterCount === 2 ? i * Math.PI : -Math.PI / 2 + (i / clusterCount) * Math.PI * 2) * orbitRadius * 0.72,
      r: scaleRadius(c.cluster_size),
      cluster: c,
      index: i,
    }))
    const sim = d3
      .forceSimulation(nodes as unknown as d3.SimulationNodeDatum[])
      .force('center', d3.forceCenter(cx, cy))
      .force(
        'collision',
        d3.forceCollide<d3.SimulationNodeDatum & { r: number }>().radius((d) => (d as { r: number }).r + 24)
      )
      .stop()
    for (let i = 0; i < 160; i++) sim.tick()
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

  const total = textCount + imageCount + audioCount + videoShotCount
  const textPct = total ? (textCount / total) * 100 : 25
  const imagePct = total ? (imageCount / total) * 100 : 25
  const audioPct = total ? (audioCount / total) * 100 : 25
  const videoPct = total ? (videoShotCount / total) * 100 : 25
  const sourceRatioLabel = total
    ? `画像样本比例：文本 ${textPct.toFixed(0)}%，图片 ${imagePct.toFixed(0)}%，音频 ${audioPct.toFixed(0)}%，视频 Shot ${videoPct.toFixed(0)}%`
    : '暂无数据源比例'
  const selectedCluster = clusters.find((cluster) => cluster.cluster_id === selectedId) ?? null
  const selectedKeywords = selectedCluster
    ? (selectedCluster.keywords?.length ? selectedCluster.keywords : extractKeywords(selectedCluster.topic_summary))
    : []
  const clusteredContentCount = clusters.reduce((count, cluster) => count + cluster.cluster_size, 0)
  const portraitSummaryText = generating
    ? '主题画像正在生成中'
    : clusters.length > 0
      ? `主题画像已生成 ${clusters.length} 个主题${selectedCluster ? `，当前选中主题包含 ${selectedCluster.cluster_size} 条内容` : ''}`
      : loading
        ? '主题画像正在加载'
        : '暂无主题画像'

  const toggleBubbleSelection = useCallback((cluster: PortraitCluster) => {
    const nextSelectedId = selectedId === cluster.cluster_id ? null : cluster.cluster_id
    setSelectedId(nextSelectedId)
    onClusterSelect?.(nextSelectedId)
  }, [onClusterSelect, selectedId])

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    onClusterSelect?.(null)
  }, [onClusterSelect])

  return (
    <div className={cn('space-y-4', className)} role="region" aria-label="知识库画像概览" aria-describedby={chartSummaryId}>
      <span id={chartSummaryId} className="sr-only" aria-live="polite">
        {portraitSummaryText}
      </span>
      <Card className="overflow-hidden rounded-[24px] border-slate-200/80 shadow-[0_20px_55px_-44px_rgba(15,57,74,0.46)] dark:border-slate-700/80">
        <CardHeader className="space-y-0 border-b border-slate-100/90 bg-[linear-gradient(110deg,rgba(247,252,251,0.96),rgba(255,255,255,0.98)_52%,rgba(238,248,247,0.92))] pb-4 pt-4 dark:border-slate-800/90 dark:bg-[linear-gradient(110deg,rgba(13,31,43,0.94),rgba(15,23,42,0.98)_52%,rgba(19,45,54,0.92))]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-[linear-gradient(145deg,#ecfeff,#eef2ff)] shadow-[0_10px_24px_-16px_rgba(6,148,162,0.9)] dark:border-cyan-400/20 dark:bg-cyan-400/10">
                <ScatterChart className="h-5 w-5 text-[#177e9b] dark:text-cyan-200" strokeWidth={2.15} aria-hidden />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#e9c46a] dark:border-slate-900" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">主题星图</CardTitle>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">按语义聚类呈现已解析内容的分布</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {clusters.length > 0 && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#b9d8d8] bg-white/80 px-3 text-xs font-semibold text-[#246276] shadow-sm dark:border-cyan-400/20 dark:bg-slate-900/60 dark:text-cyan-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1e9e9b]" />
                  {clusters.length} 个主题
                </span>
              )}
              {clusters.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={generating}
                  aria-label={generating ? '主题画像生成中' : '重新生成主题画像'}
                  className="group h-8 shrink-0 gap-2 rounded-full border-[#b9d8d8] bg-white/90 px-3 text-xs font-semibold text-[#246276] shadow-sm transition-all duration-200 hover:border-[#79b9c8] hover:bg-[#effafa] hover:text-[#0f4f65] hover:shadow-md dark:border-cyan-400/25 dark:bg-slate-900/70 dark:text-cyan-100 dark:hover:border-cyan-300/45 dark:hover:bg-cyan-950/35 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      <span>生成中…</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 transition-transform duration-300 group-hover:rotate-180" aria-hidden />
                      <span>重新生成</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
          {loading ? (
            <div className="flex h-80 items-center justify-center" role="status" aria-live="polite" aria-label="正在加载知识库主题画像">
              <div className="text-center">
                <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-fuchsia-400 dark:border-indigo-500 dark:border-t-fuchsia-500" aria-hidden />
                <p className="text-muted-foreground">正在加载画像…</p>
              </div>
            </div>
          ) : clusters.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-gradient-to-br from-indigo-50/40 via-transparent to-fuchsia-50/40 dark:from-indigo-950/30 dark:via-transparent dark:to-fuchsia-950/30" role={generating ? 'status' : 'region'} aria-label={generating ? '正在生成主题画像' : '主题画像空状态'}>
              {generating ? (
                <>
                  <div className="relative">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-indigo-800 dark:border-t-indigo-400" aria-hidden />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ScatterChart className="h-6 w-6 text-indigo-600 dark:text-indigo-400" strokeWidth={2} aria-hidden />
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-base font-medium text-slate-700 dark:text-slate-200">正在生成主题画像</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm px-4">
                      正在分析知识库内容并生成主题聚类，请稍候…
                    </p>
                    <div className="flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" aria-hidden />
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.2s' }} aria-hidden />
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.4s' }} aria-hidden />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <ScatterChart
                    className="h-10 w-10 text-indigo-600 drop-shadow-[0_1px_2px_rgba(99,102,241,0.2)] dark:text-indigo-400 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <p className="text-base font-medium text-slate-700 dark:text-slate-200 mt-2">暂无主题画像</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm text-center px-4">
                    知识库需至少有一条已完成解析的文本、图片、音频或视频 Shot，才能生成主题聚类画像。
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={generating || totalDataCount < PORTRAIT_DATA_THRESHOLD}
                    aria-label={generating ? '主题画像生成中' : '生成主题画像'}
                    className="gap-2"
                  >
                    {generating ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                        生成中…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" aria-hidden />
                        生成画像
                      </>
                    )}
                  </Button>
                  {totalDataCount < PORTRAIT_DATA_THRESHOLD && (
                    <p className="text-xs text-amber-600" role="status">当前尚无可用于画像的解析内容</p>
                  )}
                  {genError && (
                    <p className="text-xs text-destructive" role="alert">{genError}</p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div
              ref={containerRef}
              id={chartRegionId}
              className="relative min-h-[520px] w-full overflow-hidden rounded-[20px] border border-[#d4e5e3] bg-[#f7fbfa] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_14px_30px_-28px_rgba(13,72,85,0.7)] dark:border-cyan-400/15 dark:bg-slate-950 portrait-chart-container"
              role="region"
              aria-label={`主题星图，共 ${clusters.length} 个主题`}
            >
              {/* 生成中的遮罩层 */}
              {generating && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-[100] flex items-center justify-center rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-md"
                  role="status"
                  aria-live="polite"
                  aria-label="正在更新主题画像"
                >
                  <div className="text-center space-y-4">
                    <div className="relative mx-auto" style={{ width: '64px', height: '64px' }}>
                      <div className="absolute inset-0 animate-spin rounded-full border-4 border-fuchsia-200 border-t-fuchsia-600 dark:border-fuchsia-800 dark:border-t-fuchsia-400" aria-hidden />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <ScatterChart className="h-6 w-6 text-fuchsia-600 dark:text-fuchsia-400" strokeWidth={2} aria-hidden />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-base font-medium text-slate-700 dark:text-slate-200">正在更新画像</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm px-4">
                        正在分析知识库内容并重新生成主题聚类，请稍候…
                      </p>
                      <div className="flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                        <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" aria-hidden />
                        <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" style={{ animationDelay: '0.2s' }} aria-hidden />
                        <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" style={{ animationDelay: '0.4s' }} aria-hidden />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
              <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-2xl border border-white/80 bg-white/75 px-3.5 py-2.5 shadow-[0_12px_30px_-24px_rgba(15,66,79,0.72)] backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/65 sm:left-5 sm:top-5" aria-hidden>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#398297] dark:text-cyan-300">Semantic atlas</p>
                <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-[#17455a] dark:text-white">{clusters.length} 个主题</span>
                  <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                  {clusteredContentCount} 条已归类素材
                </p>
              </div>
              <div className="pointer-events-none absolute right-4 top-5 z-20 hidden items-center gap-1.5 rounded-full border border-[#d8e9e6] bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[#52747d] shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/65 dark:text-slate-300 sm:flex" aria-hidden>
                <span className="h-1.5 w-1.5 rounded-full bg-[#e9c46a] shadow-[0_0_0_3px_rgba(233,196,106,0.16)]" />
                点击星团查看摘要
              </div>
              {/* 纸张般的浅色网格让布局有坐标感，同时保持气泡为视觉主体。 */}
              <div
                className="absolute inset-0 z-0 rounded-[inherit] opacity-100 dark:opacity-0"
                style={{
                  background:
                    'radial-gradient(ellipse 76% 68% at 50% 50%, rgba(255,255,255,0.99) 0%, rgba(244,250,249,0.98) 56%, rgba(231,242,240,0.98) 100%), linear-gradient(rgba(23,126,155,0.048) 1px, transparent 1px), linear-gradient(90deg, rgba(23,126,155,0.048) 1px, transparent 1px)',
                  backgroundSize: 'auto, 30px 30px, 30px 30px',
                }}
                aria-hidden
              />
              <div
                className="absolute inset-0 z-0 hidden rounded-[inherit] dark:block"
                style={{
                  background:
                    'radial-gradient(ellipse 76% 68% at 50% 50%, rgba(24,51,63,0.98) 0%, rgba(13,31,43,0.99) 60%, rgba(10,22,31,1) 100%), linear-gradient(rgba(103,232,249,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,0.06) 1px, transparent 1px)',
                  backgroundSize: 'auto, 30px 30px, 30px 30px',
                }}
                aria-hidden
              />
              <svg
                width="100%"
                height={chartHeight}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="relative z-10 block"
                preserveAspectRatio="xMidYMid meet"
                aria-label={`知识库主题气泡图，共 ${clusters.length} 个主题，气泡大小表示文档数量`}
              >
                <defs>
                  {/* 颜色从亮心向外收束，保证主题名在任何气泡上都有足够对比。 */}
                  {bubbleTheme.tiers.map((pal, ti) => (
                    <radialGradient
                      key={`${bubbleTheme.id}-t${ti}`}
                      id={`bubble-grad-${bubbleTheme.id}-t${ti}`}
                      cx="32%"
                      cy="28%"
                      r="78%"
                    >
                      <stop offset="0%" stopColor={pal.centerLight} stopOpacity={0.98} />
                      <stop offset="26%" stopColor={pal.centerLight} stopOpacity={0.94} />
                      <stop offset="54%" stopColor={pal.fill} stopOpacity={0.97} />
                      <stop offset="80%" stopColor={pal.mid} stopOpacity={0.94} />
                      <stop offset="100%" stopColor={pal.edge} stopOpacity={0.96} />
                    </radialGradient>
                  ))}
                  <filter id="bubble-atlas-shadow" x="-35%" y="-35%" width="170%" height="180%">
                    <feDropShadow dx="0" dy="9" stdDeviation="7" floodColor="#153b4d" floodOpacity="0.22" />
                  </filter>
                  {/* 选中态：青绿色外发光，既醒目又不破坏星图的安静感。 */}
                  <filter id="bubble-selected-glow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                    <feFlood floodColor="#147d90" floodOpacity="0.52" result="fill" />
                    <feComposite in="fill" in2="blur" operator="in" result="glow" />
                    <feMerge>
                      <feMergeNode in="glow" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <g className="pointer-events-none" aria-hidden="true">
                  <ellipse cx={chartWidth / 2} cy={chartHeight / 2} rx="256" ry="156" fill="none" stroke="#1f7789" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="4 7" />
                  <ellipse cx={chartWidth / 2} cy={chartHeight / 2} rx="188" ry="108" fill="none" stroke="#1f7789" strokeOpacity="0.1" strokeWidth="1" />
                  <path d={`M${chartWidth / 2 - 286} ${chartHeight / 2}H${chartWidth / 2 + 286}M${chartWidth / 2} ${chartHeight / 2 - 196}V${chartHeight / 2 + 196}`} stroke="#1f7789" strokeOpacity="0.08" strokeWidth="1" strokeDasharray="3 8" />
                  <circle cx={chartWidth / 2} cy={chartHeight / 2} r="14" fill="#d9f0eb" fillOpacity="0.64" />
                  <circle cx={chartWidth / 2} cy={chartHeight / 2} r="4" fill="#e9c46a" fillOpacity="0.9" />
                </g>
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
                            stroke={bubbleTheme.tiers[0].mid}
                            strokeOpacity={0.38}
                            strokeWidth={1.2}
                            strokeDasharray="5 4"
                          />
                        ))}
                    </g>
                  )
                })()}
                {layoutReady &&
                  bubbleNodes.map((node) => {
                    const tierIndex = node.index % BUBBLE_THEME_TIER_COUNT
                    const palette = bubbleTheme.tiers[tierIndex]
                    const gradId = `bubble-grad-${bubbleTheme.id}-t${tierIndex}`
                    const isSelected = node.cluster.cluster_id === selectedId
                    const isHovered = node.cluster.cluster_id === hoveredNodeId
                    const allKeywords = (node.cluster.keywords && node.cluster.keywords.length > 0)
                      ? node.cluster.keywords
                      : extractKeywords(node.cluster.topic_summary)
                    const maxWords = node.r < 60 ? 2 : node.r < 80 ? 3 : node.r < 100 ? 4 : 5
                    const keywords = allKeywords.slice(0, maxWords)
                    const primaryKeyword = keywords[0] ?? `主题 ${node.index + 1}`
                    const supportingKeywords = keywords.slice(1)
                    const supportingPositions = (() => {
                      switch (supportingKeywords.length) {
                        case 1:
                          return [{ left: '50%', top: '22%' }]
                        case 2:
                          return [
                            { left: '28%', top: '29%' },
                            { left: '72%', top: '72%' },
                          ]
                        case 3:
                          return [
                            { left: '50%', top: '18%' },
                            { left: '20%', top: '68%' },
                            { left: '80%', top: '68%' },
                          ]
                        default:
                          return [
                            { left: '50%', top: '17%' },
                            { left: '17%', top: '48%' },
                            { left: '83%', top: '48%' },
                            { left: '50%', top: '83%' },
                          ]
                      }
                    })()
                    const bubbleOpacity = 0.96
                    const opacityWhenOtherHovered = hoveredNodeId && !isHovered ? 0.3 : bubbleOpacity
                    const bubbleLabel = `查看主题摘要：${keywords[0] ?? (node.cluster.topic_summary || `主题 ${node.index + 1}`)}，共 ${node.cluster.cluster_size} 条`
                    return (
                      <g
                        key={node.cluster.cluster_id}
                        transform={`translate(${node.x},${node.y})`}
                        style={{ cursor: 'pointer', opacity: opacityWhenOtherHovered }}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isSelected}
                        aria-label={bubbleLabel}
                        onMouseDown={(e) => e.preventDefault()}
                        onFocus={() => setHoveredNodeId(node.cluster.cluster_id)}
                        onBlur={() => setHoveredNodeId(null)}
                        onMouseEnter={() => setHoveredNodeId(node.cluster.cluster_id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          toggleBubbleSelection(node.cluster)
                        }}
                        onClick={() => {
                          toggleBubbleSelection(node.cluster)
                          requestAnimationFrame(() => (document.activeElement as HTMLElement)?.blur())
                        }}
                      >
                        <motion.g
                          initial={{ scale: 0.72, opacity: 0 }}
                          animate={{ scale: isHovered ? 1.075 : 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 190, damping: 19, delay: node.index * 0.045 }}
                        >
                          <circle
                            r={node.r}
                            fill={`url(#${gradId})`}
                            filter="url(#bubble-atlas-shadow)"
                          />
                          <circle
                            r={node.r}
                            fill="none"
                            stroke={palette.glowBorder}
                            strokeWidth={1.3}
                            strokeOpacity={0.8}
                          />
                          {isSelected && (
                            <g filter="url(#bubble-selected-glow)">
                              <circle
                                r={node.r + 8}
                                fill="none"
                                stroke="#147d90"
                                strokeWidth={2.25}
                                strokeOpacity={0.95}
                              />
                            </g>
                          )}
                          <foreignObject
                            x={-node.r + 4}
                            y={-node.r + 4}
                            width={Math.max(0, node.r * 2 - 8)}
                            height={Math.max(0, node.r * 2 - 8)}
                            className="pointer-events-none overflow-visible"
                          >
                            <div className="relative h-full w-full overflow-hidden rounded-full" style={{ fontFamily: WORD_CLOUD_FONT }}>
                              {supportingKeywords.map((keyword, keywordIndex) => {
                                const position = supportingPositions[keywordIndex]
                                if (!position) return null
                                return (
                                  <span
                                    key={`${keyword}-${keywordIndex}`}
                                    className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-white/20 bg-slate-950/10 px-1.5 py-0.5 text-[10px] font-medium text-white/90"
                                    style={{
                                      left: position.left,
                                      top: position.top,
                                      maxWidth: `${Math.min(node.r * 0.98, 82)}px`,
                                      textOverflow: 'ellipsis',
                                      overflow: 'hidden',
                                      textShadow: '0 1px 1px rgba(8,28,40,0.3)',
                                    }}
                                    title={keyword}
                                  >
                                    {keyword.length > 6 ? `${keyword.slice(0, 5)}…` : keyword}
                                  </span>
                                )
                              })}
                              <div className="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 px-4 text-center text-white">
                                <span
                                  className="block truncate font-black tracking-tight"
                                  style={{
                                    fontSize: Math.min(node.r * 0.28, 25),
                                    lineHeight: 1.12,
                                    textShadow: '0 1px 2px rgba(8,28,40,0.42)',
                                  }}
                                  title={primaryKeyword}
                                >
                                  {primaryKeyword.length > 9 ? `${primaryKeyword.slice(0, 8)}…` : primaryKeyword}
                                </span>
                                <span className="mt-1.5 inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/95">
                                  {node.cluster.cluster_size} 条素材
                                </span>
                              </div>
                            </div>
                          </foreignObject>
                        </motion.g>
                      </g>
                    )
                  })}
              </svg>
            </div>
          )}

          {selectedCluster && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden rounded-[18px] border border-[#b9dedd] bg-[linear-gradient(118deg,#f0fbfa,#ffffff_56%,#f4f7ff)] shadow-[0_14px_28px_-26px_rgba(16,92,105,0.72)] dark:border-cyan-300/20 dark:bg-[linear-gradient(118deg,rgba(12,48,57,0.62),rgba(15,23,42,0.78)_56%,rgba(43,35,80,0.48))]"
              aria-label="已选主题摘要"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[#d8ebe8] px-4 py-3 dark:border-cyan-300/10 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#dff4f1] px-2.5 py-1 text-[11px] font-bold text-[#176a72] dark:bg-cyan-300/10 dark:text-cyan-200">已选主题</span>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{selectedCluster.cluster_size} 条关联素材</span>
                  </div>
                  <h3 className="mt-2 truncate text-base font-semibold text-[#163d4e] dark:text-white">
                    {selectedKeywords[0] || '未命名主题'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="shrink-0 rounded-full border border-[#c6dfdc] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[#397076] transition-colors hover:border-[#73b7bd] hover:bg-[#effaf8] dark:border-cyan-300/20 dark:bg-slate-900/60 dark:text-cyan-100 dark:hover:bg-cyan-950/50"
                >
                  清除选择
                </button>
              </div>
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.6fr)] sm:px-5">
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {selectedCluster.topic_summary || '该主题暂未生成摘要。'}
                </p>
                {selectedKeywords.length > 0 && (
                  <div className="border-t border-[#dcebe8] pt-3 dark:border-cyan-300/10 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5c8990] dark:text-cyan-300">Topic signals</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedKeywords.slice(0, 6).map((keyword) => (
                        <span key={keyword} className="rounded-full border border-[#cce5e1] bg-white/75 px-2 py-1 text-xs font-medium text-[#376c72] dark:border-cyan-300/20 dark:bg-slate-900/55 dark:text-cyan-100">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          )}

          {clusters.length > 0 && (
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/75 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/45">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:items-center">
                <ScatterChart
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#177e9b] dark:text-cyan-300 sm:mt-0"
                  strokeWidth={2.25}
                  aria-hidden
                />
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-[#245c70] dark:text-cyan-100">气泡代表语义相近的素材簇</span>
                  <span className="mx-2 text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">点击星团查看主题摘要与关键信号</span>
                  <span className="mx-2 text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span className="font-semibold text-[#a6642d] dark:text-amber-200">圆的面积表示素材数量</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 数据源比例条：仅显示占比 > 0 的类型 */}
      <Card className="overflow-hidden border-slate-200/60 dark:border-slate-700/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">数据源比例</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-10 overflow-hidden rounded-xl bg-slate-100/90 dark:bg-slate-800/50 shadow-inner" role="img" aria-label={sourceRatioLabel}>
            {textCount > 0 && (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-400 via-indigo-500 to-indigo-600 text-white shadow-sm transition-all duration-300 min-w-0",
                  imageCount === 0 && audioCount === 0 && videoShotCount === 0 && "rounded-r-xl",
                  "rounded-l-xl"
                )}
                style={{ width: `${textPct}%` }}
              >
                <FileText className="h-4 w-4 flex-shrink-0 opacity-95" aria-hidden />
                <span className="text-sm font-medium truncate">Text</span>
              </div>
            )}
            {imageCount > 0 && (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 bg-gradient-to-r from-fuchsia-400 via-fuchsia-500 to-fuchsia-600 text-white shadow-sm transition-all duration-300 min-w-0",
                  textCount === 0 && "rounded-l-xl",
                  audioCount === 0 && videoShotCount === 0 && "rounded-r-xl"
                )}
                style={{ width: `${imagePct}%` }}
              >
                <Image className="h-4 w-4 flex-shrink-0 opacity-95" aria-hidden />
                <span className="text-sm font-medium truncate">Image</span>
              </div>
            )}
            {audioCount > 0 && (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-white shadow-sm transition-all duration-300 min-w-0",
                  textCount === 0 && imageCount === 0 && "rounded-l-xl",
                  videoShotCount === 0 && "rounded-r-xl"
                )}
                style={{ width: `${audioPct}%` }}
              >
                <Music className="h-4 w-4 flex-shrink-0 opacity-95" aria-hidden />
                <span className="text-sm font-medium truncate">Audio</span>
              </div>
            )}
            {videoShotCount > 0 && (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 text-white shadow-sm transition-all duration-300 min-w-0 rounded-r-xl",
                  textCount === 0 && imageCount === 0 && audioCount === 0 && "rounded-l-xl"
                )}
                style={{ width: `${videoPct}%` }}
              >
                <Video className="h-4 w-4 flex-shrink-0 opacity-95" aria-hidden />
                <span className="text-sm font-medium truncate">Video Shot</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            {textCount > 0 && (
              <span className="font-medium">Text {textCount} <span className="text-slate-400 dark:text-slate-500">({textPct.toFixed(0)}%)</span></span>
            )}
            {imageCount > 0 && (
              <span className="font-medium">Image {imageCount} <span className="text-slate-400 dark:text-slate-500">({imagePct.toFixed(0)}%)</span></span>
            )}
            {audioCount > 0 && (
              <span className="font-medium">Audio {audioCount} <span className="text-slate-400 dark:text-slate-500">({audioPct.toFixed(0)}%)</span></span>
            )}
            {videoShotCount > 0 && (
              <span className="font-medium">Video Shot {videoShotCount} <span className="text-slate-400 dark:text-slate-500">({videoPct.toFixed(0)}%)</span></span>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="list" aria-label="主题画像统计">
            <div className="rounded-xl bg-gradient-to-br from-indigo-50/90 to-indigo-100/50 dark:from-indigo-950/40 dark:to-indigo-900/20 border border-indigo-100/80 dark:border-indigo-800/40 px-4 py-3 text-center" role="listitem">
              <div className="text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {clusters.length}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-indigo-700/80 dark:text-indigo-300/90">
                <ScatterChart className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
                <span>主题数</span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 px-4 py-3 text-center" role="listitem">
              <div className="text-2xl font-bold tabular-nums text-slate-600 dark:text-slate-300">
                {documentCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <FileText className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
                <span>文档数</span>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 px-4 py-3 text-center" role="listitem">
              <div className="text-2xl font-bold tabular-nums text-slate-600 dark:text-slate-300">
                {textCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <LayoutList className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
                <span>文本块</span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-fuchsia-50/90 to-fuchsia-100/50 dark:from-fuchsia-950/40 dark:to-fuchsia-900/20 border border-fuchsia-100/80 dark:border-fuchsia-800/40 px-4 py-3 text-center" role="listitem">
              <div className="text-2xl font-bold tabular-nums text-fuchsia-600 dark:text-fuchsia-400">
                {imageCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-fuchsia-700/80 dark:text-fuchsia-300/90">
                <Image className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
                <span>图片</span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-50/90 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20 border border-amber-100/80 dark:border-amber-800/40 px-4 py-3 text-center" role="listitem">
              <div className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {audioCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-amber-700/80 dark:text-amber-300/90">
                <Music className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
                <span>音频</span>
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border border-emerald-100/80 dark:border-emerald-800/40 px-4 py-3 text-center" role="listitem">
              <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {videoShotCount}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm font-medium text-emerald-700/80 dark:text-emerald-300/90">
                <Video className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden />
                <span>视频 Shot</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
