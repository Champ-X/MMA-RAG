import { useState } from 'react'
import { Brain, Network, Search, ChevronDown, ChevronRight, CheckCircle, Image as ImageIcon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThoughtData, ThinkingState } from '@/store/useChatStore'

type StageStatus = 'idle' | 'processing' | 'completed' | 'failed'

interface ThinkingCapsuleProps {
  /** 思维数据，来自 SSE thought 事件，随阶段流式更新 */
  thoughtData?: ThoughtData | null
  /** 各阶段状态，用于按阶段逐步展示 */
  stages?: ThinkingState['stages']
  /** 当前阶段，用于高亮/加载态 */
  currentStage?: string
}

export function ThinkingCapsule({
  thoughtData,
  stages,
  currentStage,
}: ThinkingCapsuleProps) {
  // 流式思考时默认展开，方便一阶段一阶段看到更新
  const [open, setOpen] = useState(true)

  const intent = {
    type: thoughtData?.intent_type,
    originalQuery: thoughtData?.original_query,
    refinedQuery: thoughtData?.refined_query,
    needsVisual: thoughtData?.needs_visual,
  }

  const routing = thoughtData?.target_kbs || (thoughtData?.fallback_search ? { strategy: 'fallback' as const } : thoughtData?.target_kbs ? undefined : { strategy: 'weighted' as const })

  const retrieval = {
    keywords: thoughtData?.sparse_keywords || [],
    subQueries: thoughtData?.sub_queries || [],
    totalFound: thoughtData?.total_found,
    reranked: 2,
  }

  // 有 stages 时按阶段流式展示；无 stages（如历史消息）时按 thoughtData 有则展示
  const intentActive =
    (stages?.intent && stages.intent !== 'idle') ||
    (!!thoughtData && (!!thoughtData.intent_type || !!thoughtData.original_query || !!thoughtData.refined_query))
  const routingActive =
    (stages?.routing && stages.routing !== 'idle') ||
    (!!thoughtData && (Array.isArray(thoughtData.target_kbs) || thoughtData.fallback_search === true))
  const retrievalActive =
    (stages?.retrieval && stages.retrieval !== 'idle') ||
    (!!thoughtData && ((thoughtData.sparse_keywords?.length ?? 0) > 0 || (thoughtData.sub_queries?.length ?? 0) > 0 || thoughtData.total_found != null))
  const hasAnyStage = intentActive || routingActive || retrievalActive

  const stageLabel = (status: StageStatus) =>
    status === 'processing' ? '进行中…' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : ''

  return (
    <div className="mb-2 w-full rounded-xl border border-slate-200/60 bg-slate-50/80 dark:border-slate-800/60 dark:bg-slate-900/30">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100/50 hover:text-slate-800 dark:hover:bg-slate-800/50 dark:hover:text-slate-100"
      >
        <span className={cn(
          'rounded p-1',
          open ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-400'
        )}>
          <Brain size={14} />
        </span>
        <span>思考过程</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="border-l-2 border-indigo-500/50 bg-white/30 px-5 pb-4 pt-2 dark:bg-slate-950/30">
          <div className="ml-2 mt-2 space-y-3">
          {/* 阶段一：意图解析 — 仅在该阶段开始后展示，流式更新 */}
          {intentActive && (
          <div className="space-y-2 animate-fade-in">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <Brain size={12} className="text-indigo-600" />
              <span>意图解析</span>
              {stages?.intent === 'processing' && !intent.type && !intent.originalQuery && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Loader2 size={10} className="animate-spin" />
                  {stageLabel(stages.intent)}
                </span>
              )}
              {stages?.intent === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-4 space-y-1.5">
              {(intent.type || stages?.intent === 'processing') && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20">类型</span>
                  <span className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 rounded border border-blue-100 dark:border-blue-800">
                    {intent.type || '…'}
                  </span>
                </div>
              )}
              {intent.originalQuery && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">原始查询</span>
                  <span className="text-slate-600 dark:text-slate-300 flex-1">{intent.originalQuery}</span>
                </div>
              )}
              {intent.refinedQuery && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">重写查询</span>
                  <span className="text-slate-700 dark:text-slate-200 flex-1 font-medium">{intent.refinedQuery}</span>
                </div>
              )}
              {intent.needsVisual && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20">视觉模式</span>
                  <span className="text-purple-600 dark:text-purple-400 flex items-center gap-1">
                    <ImageIcon size={12} /> 图像检索已启用
                  </span>
                </div>
              )}
            </div>
          </div>
          )}

          {/* 阶段二：智能路由 — 路由阶段开始后展示 */}
          {routingActive && (
          <div className="space-y-2 animate-fade-in">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <Network size={12} className="text-indigo-600" />
              <span>智能路由</span>
              {stages?.routing === 'processing' && !Array.isArray(routing) && !(routing && 'strategy' in routing) && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Loader2 size={10} className="animate-spin" />
                  {stageLabel(stages.routing)}
                </span>
              )}
              {stages?.routing === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-4 space-y-1.5">
              {Array.isArray(routing) && routing.length > 0 ? (
                routing.map((kb: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400 dark:text-slate-500 w-20">{kb.name}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 rounded-full transition-all duration-300"
                          style={{ width: `${(kb.score || 0) * 100}%` }}
                        />
                      </div>
                      <span className="text-slate-600 dark:text-slate-300 text-[10px] w-10 text-right">
                        {Math.round((kb.score || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20">策略</span>
                  <span className="text-slate-700 dark:text-slate-200">
                    {routing && typeof routing === 'object' && 'strategy' in routing
                      ? routing.strategy === 'weighted'
                        ? '加权路由'
                        : routing.strategy === 'fallback'
                        ? '全域搜索'
                        : '手动锁定'
                      : '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
          )}

          {/* 阶段三：检索策略 — 检索阶段开始后展示 */}
          {retrievalActive && (
          <div className="space-y-2 animate-fade-in">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <Search size={12} className="text-indigo-600" />
              <span>检索策略</span>
              {stages?.retrieval === 'processing' && retrieval.keywords.length === 0 && !retrieval.subQueries?.length && retrieval.totalFound == null && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Loader2 size={10} className="animate-spin" />
                  {stageLabel(stages.retrieval)}
                </span>
              )}
              {stages?.retrieval === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-4 space-y-1.5">
              {retrieval.keywords.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">关键词</span>
                  <div className="flex-1 flex flex-wrap gap-1">
                    {retrieval.keywords.map((kw: string, idx: number) => (
                      <span key={idx} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded text-[10px] border border-slate-200 dark:border-slate-700">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {retrieval.subQueries && retrieval.subQueries.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">子查询</span>
                  <div className="flex-1 space-y-1">
                    {retrieval.subQueries.map((sq: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <CheckCircle size={10} className="text-green-500 flex-shrink-0" />
                        <span className="text-slate-600 dark:text-slate-300 text-[10px]">{sq}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {retrieval.totalFound !== undefined && retrieval.totalFound !== null && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">结果</span>
                  <span className="text-slate-700 dark:text-slate-200">
                    检索到 {retrieval.totalFound} 个片段，重排后保留 Top {retrieval.reranked || 2}
                  </span>
                </div>
              )}
            </div>
          </div>
          )}

          {!hasAnyStage && (
            <div className="flex items-center gap-2 py-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 size={12} className="animate-spin flex-shrink-0" />
              <span>等待思考阶段…</span>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
