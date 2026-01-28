import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Info, FileText, Image } from 'lucide-react'
import { cn } from '@/lib/utils'
import { knowledgeApi } from '@/services/api_client'

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
  const svgRef = useRef<SVGSVGElement>(null)
  const [clusters, setClusters] = useState<PortraitCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const run = async () => {
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
        if (!cancelled) setClusters(list)
      } catch {
        const mock: PortraitCluster[] = [
          { cluster_id: '1', topic_summary: '技术架构', cluster_size: 45 },
          { cluster_id: '2', topic_summary: 'API 文档', cluster_size: 32 },
          { cluster_id: '3', topic_summary: '数据库设计', cluster_size: 28 },
          { cluster_id: '4', topic_summary: '前端开发', cluster_size: 25 },
          { cluster_id: '5', topic_summary: '安全策略', cluster_size: 20 },
          { cluster_id: '6', topic_summary: '性能监控', cluster_size: 18 },
          { cluster_id: '7', topic_summary: '部署运维', cluster_size: 15 },
        ]
        if (!cancelled) setClusters(mock)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [knowledgeBaseId])

  useEffect(() => {
    if (!clusters.length || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = 800
    const height = 400
    const margin = { top: 20, right: 20, bottom: 20, left: 20 }

    type NodeDatum = { value: number } & PortraitCluster
    const pack = d3
      .pack<NodeDatum>()
      .size([width - margin.left - margin.right, height - margin.top - margin.bottom])
      .padding(8)

    const root = d3
      .hierarchy({
        children: clusters.map((c) => ({
          ...c,
          value: Math.max(1, c.cluster_size),
        })),
      } as { children: NodeDatum[] })
      .sum((d) => {
        const x = (d as { data?: { value?: number } }).data
        return x && typeof x.value === 'number' ? x.value : 0
      })

    const tree = pack(root as unknown as d3.HierarchyNode<NodeDatum>)
    const leaves = tree.leaves() as Array<d3.HierarchyCircularNode<NodeDatum>>

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const color = d3.scaleOrdinal(d3.schemeCategory10)

    g.selectAll('circle')
      .data(leaves)
      .enter()
      .append('circle')
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.r)
      .attr('fill', (_, i) => color(String(i)))
      .attr('stroke', (d) =>
        d.data.cluster_id === selectedId ? 'hsl(var(--primary))' : '#1e293b'
      )
      .attr('stroke-width', (d) =>
        d.data.cluster_id === selectedId ? 3 : 1.5
      )
      .style('cursor', 'pointer')
      .on('click', (_, d) => {
        const id = d.data.cluster_id
        setSelectedId((prev) => {
          const next = prev === id ? null : id
          onClusterSelect?.(next)
          return next
        })
      })

    g.selectAll('text')
      .data(leaves)
      .enter()
      .append('text')
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', (d) => Math.min(12, d.r / 2))
      .attr('fill', '#fff')
      .attr('pointer-events', 'none')
      .text((d) => d.data.topic_summary)
  }, [clusters, selectedId, onClusterSelect])

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
                <p className="text-muted-foreground">正在生成画像…</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <svg ref={svgRef} className="w-full max-w-full" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            点击气泡可筛选该簇下的文档；气泡大小表示 cluster_size。
          </p>
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
