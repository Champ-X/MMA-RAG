import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Info, FileText, Image, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { knowledgeApi } from '@/services/api_client'

const BUBBLE_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500',
  'bg-cyan-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500',
]

export interface PortraitCluster {
  cluster_id: string
  topic_summary: string
  cluster_size: number
}

interface PortraitGraphProps {
  knowledgeBaseId: string
  /** 文本条数，用于比例条 */
  textCount?: number
  /** 图片条数，用于比例条 */
  imageCount?: number
  /** 选中簇时过滤下方列表 */
  onClusterSelect?: (clusterId: string | null) => void
  className?: string
}

export function PortraitGraph({
  knowledgeBaseId,
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
            <div className="min-h-[320px] rounded-lg bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 p-6 flex flex-wrap items-center justify-center gap-4 content-center">
              {clusters.map((c, i) => {
                const sizePct = Math.max(15, Math.min(35, (c.cluster_size / maxSize) * 30 + 15))
                const isSelected = c.cluster_id === selectedId
                return (
                  <button
                    key={c.cluster_id}
                    type="button"
                    onClick={() => {
                      const next = isSelected ? null : c.cluster_id
                      setSelectedId(next)
                      onClusterSelect?.(next ?? null)
                    }}
                    className={cn(
                      'rounded-full flex items-center justify-center text-white font-medium transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2',
                      BUBBLE_COLORS[i % BUBBLE_COLORS.length],
                      isSelected && 'ring-2 ring-offset-2 ring-indigo-500 scale-105'
                    )}
                    style={{
                      width: `${sizePct}%`,
                      minWidth: 80,
                      maxWidth: 180,
                      aspectRatio: '1',
                      padding: '0.5rem',
                    }}
                  >
                    <span className="text-xs sm:text-sm leading-tight line-clamp-3 text-center px-1">
                      {c.topic_summary || `主题 ${i + 1}`}
                    </span>
                  </button>
                )
              })}
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
                {clusters.reduce((a, c) => a + c.cluster_size, 0)}
              </div>
              <div className="text-sm text-muted-foreground">文档数</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {textCount}
              </div>
              <div className="text-sm text-muted-foreground">文本</div>
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
