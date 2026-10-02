import { useEffect, useState, useCallback, useId, useRef } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScatterChart, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { knowledgeApi } from '@/services/api_client'
import { TopicAtlas } from './TopicAtlas'
import { PortraitStatistics } from './PortraitStatistics'

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
  /** 文本块条数（chunk 数），用于样本构成 */
  textCount?: number
  /** 图片条数，用于样本构成 */
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
      <Card className="portrait-atlas-card">
        <CardHeader className="portrait-atlas-header">
          <div className="portrait-atlas-heading">
            <span className="portrait-atlas-mark" aria-hidden="true">
              <svg viewBox="0 0 36 36" fill="none">
                <circle cx="14" cy="20" r="10" fill="#cce5de" stroke="#51978c" strokeWidth="1.2" />
                <circle cx="28" cy="10" r="5" fill="#dce6f7" stroke="#7193c7" strokeWidth="1.2" />
                <circle cx="29" cy="28" r="3.5" fill="#f0e2c6" stroke="#bca16a" strokeWidth="1.1" />
                <circle cx="14" cy="20" r="2" fill="#378478" />
              </svg>
            </span>
            <div>
              <CardTitle className="portrait-atlas-title">主题星图</CardTitle>
              <p>从内容分布，发现主题与线索</p>
            </div>
          </div>
          {clusters.length > 0 && (
            <button
              type="button"
              className="portrait-atlas-regenerate"
              onClick={handleRegenerate}
              disabled={generating}
              aria-label={generating ? '主题画像生成中' : '重新生成主题画像'}
            >
              <span aria-hidden="true"><RefreshCw size={14} strokeWidth={1.7} className={generating ? 'motion-safe:animate-spin' : undefined} /></span>
              <span>{generating ? '生成中…' : '重新生成'}</span>
            </button>
          )}
        </CardHeader>
        <CardContent className="portrait-atlas-content space-y-4">
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

      <PortraitStatistics
        key={knowledgeBaseId}
        topicCount={loading ? undefined : clusters.length}
        documentCount={documentCount}
        textCount={textCount}
        imageCount={imageCount}
        audioCount={audioCount}
        videoShotCount={videoShotCount}
      />

    </div>
  )
}
