import { useState } from 'react'
import { Brain, Network, Search, ChevronDown, ChevronRight, CheckCircle, Image as ImageIcon, Music, Video, Loader2, Sparkles, FileText, Wand2 } from 'lucide-react'
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
    visualIntent: thoughtData?.visual_intent,
    visualReasoning: thoughtData?.visual_reasoning,
    audioIntent: thoughtData?.audio_intent,
    audioReasoning: thoughtData?.audio_reasoning,
    videoIntent: thoughtData?.video_intent,
    videoReasoning: thoughtData?.video_reasoning,
  }

  const routing = thoughtData?.target_kbs || (thoughtData?.fallback_search ? { strategy: 'fallback' as const } : thoughtData?.target_kbs ? undefined : { strategy: 'weighted' as const })

  const retrieval = {
    keywords: thoughtData?.sparse_keywords || [],
    subQueries: thoughtData?.sub_queries || [],
    totalFound: thoughtData?.total_found,
    reranked: thoughtData?.reranked_count,
  }

  // 获取生成阶段的状态信息
  // 如果生成已完成，强制清除状态信息，避免显示旧的动效
  // 检查 message.thinking 中的完成标记
  const isGenerationCompleted = stages?.generation === 'completed' || (thoughtData as any)?._generation_completed === true
  const generationStatus = isGenerationCompleted
    ? null 
    : ((thoughtData as any)?.generation_status || (thoughtData as any)?.status)
  const generationMessage = isGenerationCompleted
    ? ''
    : ((thoughtData as any)?.generation_message || (thoughtData as any)?.message || '')

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
  // 生成阶段只有在以下情况才显示：
  // 1. 明确收到 generation 阶段的事件（currentStage === 'generation'）
  // 2. 或者生成阶段状态为 processing 或 completed
  // 3. 或者有明确的生成状态信息
  // 4. 或者从 message.thinking 中检测到完成标记
  // 注意：检索阶段完成时，不应该显示生成阶段，直到明确收到 generation 事件
  const generationActive =
    isGenerationCompleted || stages?.generation === 'completed' // 已完成时也要显示完成状态
      ? true
      : (currentStage === 'generation' && stages?.generation !== 'idle') || // 必须是 generation 阶段且状态不是 idle
        (stages?.generation === 'processing') || // 或者明确是 processing 状态
        (!!generationStatus && currentStage === 'generation') // 或者有生成状态且当前阶段是 generation
  const hasAnyStage = intentActive || routingActive || retrievalActive || generationActive

  const stageLabel = (status: StageStatus) =>
    status === 'processing' ? '进行中…' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : ''

  // 折叠时展示的阶段摘要：意图解析 ✓ · 智能路由 ✓ · 检索中…
  const summaryParts: string[] = []
  if (intentActive) {
    summaryParts.push(stages?.intent === 'completed' ? '意图解析 ✓' : stages?.intent === 'processing' ? '意图解析…' : '意图解析 ✓')
  }
  if (routingActive) {
    summaryParts.push(stages?.routing === 'completed' ? '智能路由 ✓' : stages?.routing === 'processing' ? '智能路由…' : '智能路由 ✓')
  }
  if (retrievalActive) {
    summaryParts.push(stages?.retrieval === 'completed' ? '检索 ✓' : stages?.retrieval === 'processing' ? '检索中…' : '检索 ✓')
  }
  if (generationActive) {
    summaryParts.push(stages?.generation === 'completed' ? '生成 ✓' : stages?.generation === 'processing' ? '生成中…' : '生成 ✓')
  }
  // 当前阶段高亮样式：统一圆角与内边距，极细边框，过渡动画
  const stageBlockBase = 'space-y-2 animate-fade-in rounded-lg p-3 transition-colors duration-200'
  const stageBlockCurrent = 'bg-gradient-to-r from-indigo-50/80 to-transparent dark:from-indigo-950/30 dark:to-transparent shadow-sm border border-indigo-200/60 dark:border-indigo-800/40'
  const stageBlockIdle = 'border border-transparent'
  const summaryLine = summaryParts.length > 0 ? summaryParts.join(' · ') : null

  return (
    <div className="mb-2 w-full rounded-xl border border-slate-200/60 bg-gradient-to-br from-slate-50/90 to-slate-100/50 dark:from-slate-900/40 dark:to-slate-800/30 shadow-sm dark:border-slate-800/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 hover:text-slate-900 dark:hover:bg-slate-800/60 dark:hover:text-slate-100 transition-colors rounded-t-xl"
      >
        <span className={cn(
          'rounded-lg p-1.5 transition-all',
          open 
            ? 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-700 dark:text-indigo-300 shadow-sm' 
            : 'bg-slate-200/80 dark:bg-slate-700/80 text-slate-600 dark:text-slate-400'
        )}>
          <Brain size={14} />
        </span>
        <span className="font-semibold">思考过程</span>
        {!open && summaryLine && (
          <span className="flex-1 min-w-0 truncate text-slate-500 dark:text-slate-400 font-normal">
            {summaryLine}
          </span>
        )}
        {open ? <ChevronDown size={14} className="ml-auto flex-shrink-0" /> : <ChevronRight size={14} className="ml-auto flex-shrink-0" />}
      </button>
      {open && (
        <div className="bg-white/40 px-5 pb-4 pt-3 dark:bg-slate-950/40 rounded-b-xl">
          <div className="mt-1 space-y-4">
          {/* 阶段一：意图解析 — 仅在该阶段开始后展示，流式更新 */}
          {intentActive && (
          <div className={cn(
            stageBlockBase,
            currentStage === 'intent' ? stageBlockCurrent : stageBlockIdle
          )}>
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
              {intent.visualIntent && intent.visualIntent !== 'unnecessary' && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">视觉意图</span>
                  <div className="flex-1 space-y-1">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                      intent.visualIntent === 'explicit_demand' 
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    )}>
                      <ImageIcon size={12} />
                      {intent.visualIntent === 'explicit_demand' ? '显式需求' : '隐性增益'}
                    </span>
                    {intent.visualReasoning && (
                      <div className="text-slate-600 dark:text-slate-400 text-xs mt-1">
                        {intent.visualReasoning}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {intent.audioIntent && intent.audioIntent !== 'unnecessary' && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">音频意图</span>
                  <div className="flex-1 space-y-1">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                      intent.audioIntent === 'explicit_demand'
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        : "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                    )}>
                      <Music size={12} />
                      {intent.audioIntent === 'explicit_demand' ? '显式需求' : '隐性增益'}
                    </span>
                    {intent.audioReasoning && (
                      <div className="text-slate-600 dark:text-slate-400 text-xs mt-1">
                        {intent.audioReasoning}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {intent.videoIntent && intent.videoIntent !== 'unnecessary' && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-slate-400 dark:text-slate-500 w-20 flex-shrink-0">视频意图</span>
                  <div className="flex-1 space-y-1">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                      intent.videoIntent === 'explicit_demand'
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                        : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                    )}>
                      <Video size={12} />
                      {intent.videoIntent === 'explicit_demand' ? '显式需求' : '隐性增益'}
                    </span>
                    {intent.videoReasoning && (
                      <div className="text-slate-600 dark:text-slate-400 text-xs mt-1">
                        {intent.videoReasoning}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          )}

          {/* 阶段二：智能路由 — 路由阶段开始后展示 */}
          {routingActive && (
          <div className={cn(
            stageBlockBase,
            currentStage === 'routing' ? stageBlockCurrent : stageBlockIdle
          )}>
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
                routing.map((kb: any, idx: number) => {
                  const score = kb.score || 0
                  const percentage = Math.round(score * 100)
                  return (
                    <div key={idx} className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500 dark:text-slate-400 w-20 font-medium truncate">{kb.name}</span>
                      <div className="flex-1 flex items-center gap-2.5">
                        <div className="flex-1 h-2 bg-slate-200/80 dark:bg-slate-700/60 rounded-full overflow-hidden shadow-inner">
                          <div 
                            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 rounded-full transition-all duration-500 ease-out shadow-sm relative"
                            style={{ width: `${score * 100}%` }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-full animate-shimmer" />
                          </div>
                        </div>
                        <span className="text-slate-700 dark:text-slate-200 text-[10px] font-semibold w-10 text-right tabular-nums">
                          {percentage}%
                        </span>
                      </div>
                    </div>
                  )
                })
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
          <div className={cn(
            stageBlockBase,
            currentStage === 'retrieval' ? stageBlockCurrent : stageBlockIdle
          )}>
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
                  <div className="flex-1 flex flex-wrap gap-1.5">
                    {retrieval.keywords.map((kw: string, idx: number) => (
                      <span 
                        key={idx} 
                        className="px-2.5 py-1 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 text-blue-700 dark:text-blue-300 rounded-lg text-[10px] font-medium border border-blue-200/60 dark:border-blue-800/60 shadow-sm hover:shadow-md hover:scale-105 transition-all duration-200 cursor-default"
                      >
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
                    检索到 {retrieval.totalFound} 个片段{retrieval.reranked !== undefined && retrieval.reranked !== null ? `，重排后保留 Top ${retrieval.reranked}` : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
          )}

          {/* 阶段四：生成回答 — 只有在明确收到 generation 事件后才显示 */}
          {generationActive && (
          <div className={cn(
            stageBlockBase,
            currentStage === 'generation' ? stageBlockCurrent : stageBlockIdle
          )}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <Sparkles size={12} className="text-indigo-600" />
              <span>生成回答</span>
              {stages?.generation === 'processing' && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Loader2 size={10} className="animate-spin" />
                  {stageLabel(stages.generation)}
                </span>
              )}
              {stages?.generation === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-4 space-y-2">
              {/* 生成完成后，隐藏动效，只显示完成状态 */}
              {isGenerationCompleted || stages?.generation === 'completed' ? (
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-cyan-50/80 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-cyan-950/30 border border-emerald-200/60 dark:border-emerald-800/40 shadow-sm">
                  <div className="relative">
                    <CheckCircle size={16} className="text-emerald-500 dark:text-emerald-400" strokeWidth={2.5} />
                    <div className="absolute inset-0 animate-ping opacity-20">
                      <CheckCircle size={16} className="text-emerald-400" />
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      回答已就绪
                    </span>
                    <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                      内容已生成完成
                    </span>
                  </div>
                </div>
              ) : !stages?.generation || stages.generation === 'idle' ? null : generationStatus === 'preparing' || generationStatus === 'building_context' || (!generationStatus && stages?.generation === 'processing') ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="relative">
                      <Loader2 size={14} className="animate-spin text-indigo-500" />
                      <div className="absolute inset-0 animate-ping">
                        <Loader2 size={14} className="text-indigo-300 opacity-30" />
                      </div>
                    </div>
                    <span className="animate-pulse">{generationMessage || '正在准备生成回答...'}</span>
                  </div>
                  {/* 进度条动效 */}
                  <div className="h-1.5 bg-slate-200/60 dark:bg-slate-700/40 rounded-full overflow-hidden relative">
                    <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 rounded-full transition-all duration-1000" style={{ width: '60%' }}>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                    </div>
                  </div>
                </div>
              ) : generationStatus === 'preparing_prompt' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <FileText size={14} className="text-purple-500 animate-pulse" />
                    <span>{generationMessage || '正在准备提示词...'}</span>
                  </div>
                  {/* 进度条动效 */}
                  <div className="h-1.5 bg-slate-200/60 dark:bg-slate-700/40 rounded-full overflow-hidden relative">
                    <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 rounded-full transition-all duration-1000" style={{ width: '80%' }}>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                    </div>
                  </div>
                </div>
              ) : generationStatus === 'generating' || (!generationStatus && stages?.generation === 'processing') ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <Wand2 size={14} className="text-fuchsia-500 animate-bounce" />
                    <span className="animate-pulse">{generationMessage || '正在生成回答...'}</span>
                  </div>
                  {/* 波浪动效进度条 */}
                  <div className="h-1.5 bg-slate-200/60 dark:bg-slate-700/40 rounded-full overflow-hidden relative">
                    <div className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 rounded-full transition-all duration-1000" style={{ width: '95%' }}>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                    </div>
                  </div>
                  {/* 闪烁的提示文字 */}
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping" />
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-ping" style={{ animationDelay: '0.2s' }} />
                      <span className="w-1.5 h-1.5 bg-fuchsia-400 rounded-full animate-ping" style={{ animationDelay: '0.4s' }} />
                    </span>
                    <span>模型正在思考中，请稍候...</span>
                  </div>
                </div>
              ) : generationMessage ? (
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <Loader2 size={12} className="animate-spin text-indigo-500" />
                  <span>{generationMessage}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 size={12} className="animate-spin flex-shrink-0" />
                  <span>正在生成回答...</span>
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
