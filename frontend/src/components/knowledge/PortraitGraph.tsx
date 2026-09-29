import { useEffect, useState, useCallback, useId, useRef } from 'react'
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
import { TopicAtlas } from './TopicAtlas'

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
  const portraitId = useId().replace(/:/g, '')
  const chartSummaryId = `${portraitId}-portrait-summary`

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

  const total = textCount + imageCount + audioCount + videoShotCount
  const textPct = total ? (textCount / total) * 100 : 25
  const imagePct = total ? (imageCount / total) * 100 : 25
  const audioPct = total ? (audioCount / total) * 100 : 25
  const videoPct = total ? (videoShotCount / total) * 100 : 25
  const sourceRatioLabel = total
    ? `画像样本比例：文本 ${textPct.toFixed(0)}%，图片 ${imagePct.toFixed(0)}%，音频 ${audioPct.toFixed(0)}%，视频 Shot ${videoPct.toFixed(0)}%`
    : '暂无数据源比例'
  const selectedCluster = clusters.find((cluster) => cluster.cluster_id === selectedId) ?? null
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
      <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-[0_20px_55px_-44px_rgba(15,57,74,0.46)] dark:border-slate-700/80">
        <CardHeader className="space-y-0 border-b border-slate-100/90 bg-[linear-gradient(110deg,rgba(247,252,251,0.96),rgba(255,255,255,0.98)_52%,rgba(238,248,247,0.92))] pb-4 pt-4 dark:border-slate-800/90 dark:bg-[linear-gradient(110deg,rgba(13,31,43,0.94),rgba(15,23,42,0.98)_52%,rgba(19,45,54,0.92))]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-[linear-gradient(145deg,#ecfeff,#eef2ff)] shadow-[0_10px_24px_-16px_rgba(6,148,162,0.9)] dark:border-cyan-400/20 dark:bg-cyan-400/10">
                <ScatterChart className="h-5 w-5 text-[#177e9b] dark:text-cyan-200" strokeWidth={2.15} aria-hidden />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#e9c46a] dark:border-slate-900" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">主题星图</CardTitle>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">从内容分布中发现主题，探索摘要与关键词</p>
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
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
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
                <div className="mx-auto mb-2 h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-indigo-400 border-t-fuchsia-400 dark:border-indigo-500 dark:border-t-fuchsia-500" aria-hidden />
                <p className="text-muted-foreground">正在加载画像…</p>
              </div>
            </div>
          ) : clusters.length === 0 ? (
            <div className="flex h-80 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-gradient-to-br from-indigo-50/40 via-transparent to-fuchsia-50/40 dark:from-indigo-950/30 dark:via-transparent dark:to-fuchsia-950/30" role={generating ? 'status' : 'region'} aria-label={generating ? '正在生成主题画像' : '主题画像空状态'}>
              {generating ? (
                <>
                  <div className="relative">
                    <div className="h-16 w-16 motion-safe:animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600 dark:border-indigo-800 dark:border-t-indigo-400" aria-hidden />
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
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-pulse" aria-hidden />
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-pulse" style={{ animationDelay: '0.2s' }} aria-hidden />
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 motion-safe:animate-pulse" style={{ animationDelay: '0.4s' }} aria-hidden />
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
                        <RefreshCw className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
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
            <TopicAtlas
              key={knowledgeBaseId}
              clusters={clusters}
              selectedId={selectedId}
              onSelect={toggleBubbleSelection}
              onClear={clearSelection}
            />
          )}
          {generating && clusters.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700 dark:bg-teal-950/40 dark:text-teal-200" role="status">
              <RefreshCw className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
              正在更新主题，完成前仍可浏览当前星图。
            </p>
          )}
          {genError && clusters.length > 0 && <p className="text-xs text-destructive" role="alert">{genError}</p>}
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
