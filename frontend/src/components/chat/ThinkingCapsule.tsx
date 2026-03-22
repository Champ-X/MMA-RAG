import { useState } from 'react'
import { Brain, Network, Search, ChevronDown, ChevronRight, CheckCircle, Image as ImageIcon, Music, Video, Sparkles, FileText, Wand2, Target } from 'lucide-react'
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

/** 环形旋转，比 Loader2 更轻、与「进行中」文案同色系 */
function ThinkingDonutSpinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-full border-2 border-current/35 border-t-current opacity-95 animate-thinking-spin',
        className
      )}
      aria-hidden
    />
  )
}

/** 阶段标题行：进行中 */
function StageProcessingCue({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
      <ThinkingDonutSpinner className="size-3" />
      <span className="text-[10px] font-medium animate-pulse-soft">{text}</span>
    </span>
  )
}

/** 不确定进度：色块往复滑动 + 高光扫过 */
function IndeterminateThinkingBar() {
  return (
    <div className="relative h-1.5 overflow-hidden bg-slate-200/80 shadow-inner dark:bg-slate-800/80">
      <div className="absolute inset-y-0 w-[40%] animate-thinking-slide bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 shadow-[0_0_12px_-3px_rgba(124,58,237,0.5)] dark:shadow-[0_0_14px_-3px_rgba(167,139,250,0.38)]">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-shimmer opacity-80" />
      </div>
    </div>
  )
}

/** 底部「思考中」错落呼吸点，替代 ping 扩散 */
function ThinkingStaggerDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 shrink-0 bg-gradient-to-b from-indigo-500 to-fuchsia-500 dark:from-indigo-400 dark:to-fuchsia-400 animate-thinking-dot"
          style={{ animationDelay: `${i * 0.14}s` }}
        />
      ))}
    </span>
  )
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
  /** 各阶段底色区分；当前阶段左侧加强调条 */
  const stageSkin = {
    intent: {
      bg: 'bg-violet-50/95 dark:bg-violet-950/25',
      bgCurrent: 'bg-violet-100/95 dark:bg-violet-950/40',
      bar: 'border-l-violet-500 dark:border-l-violet-400',
      icon: 'text-violet-600 dark:text-violet-400',
    },
    routing: {
      bg: 'bg-indigo-50/90 dark:bg-indigo-950/22',
      bgCurrent: 'bg-indigo-100/90 dark:bg-indigo-950/38',
      bar: 'border-l-indigo-500 dark:border-l-indigo-400',
      icon: 'text-indigo-600 dark:text-indigo-400',
    },
    retrieval: {
      bg: 'bg-sky-50/85 dark:bg-sky-950/20',
      bgCurrent: 'bg-sky-100/90 dark:bg-sky-950/35',
      bar: 'border-l-sky-500 dark:border-l-sky-400',
      icon: 'text-sky-600 dark:text-sky-400',
    },
    generation: {
      bg: 'bg-teal-50/85 dark:bg-teal-950/20',
      bgCurrent: 'bg-teal-100/90 dark:bg-teal-950/35',
      bar: 'border-l-teal-500 dark:border-l-teal-400',
      icon: 'text-teal-600 dark:text-teal-400',
    },
  } as const

  const stageBlockClass = (key: keyof typeof stageSkin, isCurrent: boolean) =>
    cn(
      'space-y-1.5 border-b border-slate-200/55 px-2.5 py-1.5 last:border-b-0 animate-fade-in transition-colors duration-200 dark:border-slate-700/50',
      stageSkin[key][isCurrent ? 'bgCurrent' : 'bg'],
      isCurrent && 'border-l-2 pl-2',
      isCurrent && stageSkin[key].bar
    )

  const pillTag =
    'inline-flex items-center border px-2 py-0.5 text-[10px] font-semibold tracking-wide shadow-sm transition-[transform,box-shadow] duration-200 hover:shadow-md'
  const summaryLine = summaryParts.length > 0 ? summaryParts.join(' · ') : null

  return (
    <div
      className={cn(
        'group/capsule mb-2 w-full overflow-hidden border border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-950',
        'shadow-sm dark:shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'relative flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-colors duration-200',
          'border-b border-slate-200/80 bg-slate-50/90 text-slate-700 dark:border-slate-700/80 dark:bg-slate-900/60 dark:text-slate-100',
          'hover:bg-slate-100/90 dark:hover:bg-slate-900/90'
        )}
      >
        <Brain
          size={15}
          strokeWidth={2}
          className={cn(
            'shrink-0',
            open ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
          )}
        />
        <span className="font-semibold tracking-tight text-slate-800 dark:text-slate-100">思考过程</span>
        {!open && summaryLine && (
          <span className="min-w-0 flex-1 truncate font-normal text-slate-500 dark:text-slate-400">
            {summaryLine}
          </span>
        )}
        <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center border border-slate-200/70 bg-white text-slate-500 transition-transform duration-200 group-hover/capsule:scale-[1.02] dark:border-slate-600/70 dark:bg-slate-900 dark:text-slate-400">
          {open ? <ChevronDown size={14} strokeWidth={2.25} /> : <ChevronRight size={14} strokeWidth={2.25} />}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100/90 bg-slate-50/30 px-3 pb-2 pt-0 dark:border-slate-800/80 dark:bg-slate-950/40 sm:px-3.5">
          <div className="flex flex-col">
          {/* 阶段一：意图解析 — 仅在该阶段开始后展示，流式更新 */}
          {intentActive && (
          <div className={stageBlockClass('intent', currentStage === 'intent')}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Target size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.intent.icon)} />
              <span className="tracking-tight">意图解析</span>
              {stages?.intent === 'processing' && !intent.type && !intent.originalQuery && (
                <StageProcessingCue text={stageLabel(stages.intent)} />
              )}
              {stages?.intent === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {(intent.type || stages?.intent === 'processing') && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-slate-400 dark:text-slate-500">类型</span>
                  <span
                    className={cn(
                      pillTag,
                      'normal-case tracking-normal',
                      'border-sky-200/80 bg-gradient-to-br from-sky-50 to-blue-50/90 text-sky-700 dark:border-sky-500/30 dark:from-sky-950/50 dark:to-blue-950/40 dark:text-sky-300'
                    )}
                  >
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
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">视觉意图</span>
                  <div className="flex-1 space-y-1.5">
                    <span
                      className={cn(
                        pillTag,
                        'gap-1 normal-case',
                        intent.visualIntent === 'explicit_demand'
                          ? 'border-purple-200/90 bg-gradient-to-br from-purple-50 to-fuchsia-50/80 text-purple-800 dark:border-purple-500/35 dark:from-purple-950/45 dark:to-fuchsia-950/35 dark:text-purple-200'
                          : 'border-blue-200/90 bg-gradient-to-br from-blue-50 to-indigo-50/70 text-blue-800 dark:border-blue-500/35 dark:from-blue-950/45 dark:to-indigo-950/35 dark:text-blue-200'
                      )}
                    >
                      <ImageIcon size={11} strokeWidth={2.25} />
                      {intent.visualIntent === 'explicit_demand' ? '显式需求' : '隐性增益'}
                    </span>
                    {intent.visualReasoning && (
                      <div className="border border-slate-100/90 bg-slate-50/80 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
                        {intent.visualReasoning}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {intent.audioIntent && intent.audioIntent !== 'unnecessary' && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">音频意图</span>
                  <div className="flex-1 space-y-1.5">
                    <span
                      className={cn(
                        pillTag,
                        'gap-1 normal-case',
                        intent.audioIntent === 'explicit_demand'
                          ? 'border-amber-200/90 bg-gradient-to-br from-amber-50 to-orange-50/70 text-amber-900 dark:border-amber-500/35 dark:from-amber-950/40 dark:to-orange-950/30 dark:text-amber-200'
                          : 'border-teal-200/90 bg-gradient-to-br from-teal-50 to-emerald-50/70 text-teal-900 dark:border-teal-500/35 dark:from-teal-950/40 dark:to-emerald-950/30 dark:text-teal-200'
                      )}
                    >
                      <Music size={11} strokeWidth={2.25} />
                      {intent.audioIntent === 'explicit_demand' ? '显式需求' : '隐性增益'}
                    </span>
                    {intent.audioReasoning && (
                      <div className="border border-slate-100/90 bg-slate-50/80 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
                        {intent.audioReasoning}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {intent.videoIntent && intent.videoIntent !== 'unnecessary' && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">视频意图</span>
                  <div className="flex-1 space-y-1.5">
                    <span
                      className={cn(
                        pillTag,
                        'gap-1 normal-case',
                        intent.videoIntent === 'explicit_demand'
                          ? 'border-rose-200/90 bg-gradient-to-br from-rose-50 to-red-50/70 text-rose-900 dark:border-rose-500/35 dark:from-rose-950/40 dark:to-red-950/30 dark:text-rose-200'
                          : 'border-sky-200/90 bg-gradient-to-br from-sky-50 to-cyan-50/70 text-sky-900 dark:border-sky-500/35 dark:from-sky-950/40 dark:to-cyan-950/30 dark:text-sky-200'
                      )}
                    >
                      <Video size={11} strokeWidth={2.25} />
                      {intent.videoIntent === 'explicit_demand' ? '显式需求' : '隐性增益'}
                    </span>
                    {intent.videoReasoning && (
                      <div className="border border-slate-100/90 bg-slate-50/80 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
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
          <div className={stageBlockClass('routing', currentStage === 'routing')}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Network size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.routing.icon)} />
              <span className="tracking-tight">智能路由</span>
              {stages?.routing === 'processing' && !Array.isArray(routing) && !(routing && 'strategy' in routing) && (
                <StageProcessingCue text={stageLabel(stages.routing)} />
              )}
              {stages?.routing === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {Array.isArray(routing) && routing.length > 0 ? (
                routing.map((kb: any, idx: number) => {
                  const score = kb.score || 0
                  const percentage = Math.round(score * 100)
                  return (
                    <div key={idx} className="flex items-center gap-3 text-xs">
                      <span className="w-20 shrink-0 truncate font-medium text-slate-600 dark:text-slate-400">{kb.name}</span>
                      <div className="flex flex-1 items-center gap-2.5">
                        <div className="relative h-2 flex-1 overflow-hidden bg-slate-200/90 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] dark:bg-slate-800/90 dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]">
                          <div
                            className="relative h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 shadow-[0_0_8px_-2px_rgba(99,102,241,0.55)] transition-all duration-500 ease-out dark:shadow-[0_0_10px_-2px_rgba(129,140,248,0.45)]"
                            style={{ width: `${score * 100}%` }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
                          </div>
                        </div>
                        <span className="w-10 shrink-0 text-right text-[10px] font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
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
          <div className={stageBlockClass('retrieval', currentStage === 'retrieval')}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Search size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.retrieval.icon)} />
              <span className="tracking-tight">检索策略</span>
              {stages?.retrieval === 'processing' && retrieval.keywords.length === 0 && !retrieval.subQueries?.length && retrieval.totalFound == null && (
                <StageProcessingCue text={stageLabel(stages.retrieval)} />
              )}
              {stages?.retrieval === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {retrieval.keywords.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">关键词</span>
                  <div className="flex flex-1 flex-wrap gap-1">
                    {retrieval.keywords.map((kw: string, idx: number) => (
                      <span
                        key={idx}
                        className="cursor-default border border-sky-200/90 bg-sky-50/90 px-2 py-0.5 text-[10px] font-semibold text-sky-800 shadow-sm transition-shadow duration-200 hover:shadow dark:border-sky-500/35 dark:bg-sky-950/40 dark:text-sky-200"
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
                  <span className="border border-slate-200/80 bg-white/90 px-2 py-0.5 text-[11px] leading-snug text-slate-700 shadow-sm dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-200">
                    检索到 {retrieval.totalFound} 个片段
                    {retrieval.reranked !== undefined && retrieval.reranked !== null
                      ? `，重排后保留 Top ${retrieval.reranked}`
                      : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
          )}

          {/* 阶段四：生成回答 — 只有在明确收到 generation 事件后才显示 */}
          {generationActive && (
          <div className={stageBlockClass('generation', currentStage === 'generation')}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Sparkles size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.generation.icon)} />
              <span className="tracking-tight">生成回答</span>
              {stages?.generation === 'processing' && (
                <StageProcessingCue text={stageLabel(stages.generation)} />
              )}
              {stages?.generation === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {/* 生成完成后，隐藏动效，只显示完成状态 */}
              {isGenerationCompleted || stages?.generation === 'completed' ? (
                <div className="relative flex items-center gap-2.5 overflow-hidden border border-emerald-200/80 bg-emerald-50/95 px-2.5 py-2 shadow-sm dark:border-emerald-700/50 dark:bg-emerald-950/35">
                  <span className="absolute bottom-0 left-0 top-0 w-0.5 bg-emerald-500 dark:bg-emerald-400" aria-hidden />
                  <CheckCircle className="shrink-0 text-emerald-600 dark:text-emerald-400" size={18} strokeWidth={2.25} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">回答已就绪</span>
                    <span className="text-[10px] text-emerald-700/75 dark:text-emerald-300/80">内容已生成完成</span>
                  </div>
                </div>
              ) : !stages?.generation || stages.generation === 'idle' ? null : generationStatus === 'preparing' || generationStatus === 'building_context' || (!generationStatus && stages?.generation === 'processing') ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <ThinkingDonutSpinner className="size-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span className="animate-pulse-soft">{generationMessage || '正在准备生成回答...'}</span>
                  </div>
                  <IndeterminateThinkingBar />
                </div>
              ) : generationStatus === 'preparing_prompt' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <FileText size={14} className="shrink-0 text-purple-500 animate-pulse-soft dark:text-purple-400" />
                    <span className="animate-pulse-soft">{generationMessage || '正在准备提示词...'}</span>
                  </div>
                  <IndeterminateThinkingBar />
                </div>
              ) : generationStatus === 'generating' || (!generationStatus && stages?.generation === 'processing') ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <Wand2
                      size={14}
                      className="shrink-0 origin-[30%_70%] text-fuchsia-500 animate-thinking-wand dark:text-fuchsia-400"
                    />
                    <span className="animate-pulse-soft">{generationMessage || '正在生成回答...'}</span>
                  </div>
                  <IndeterminateThinkingBar />
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                    <ThinkingStaggerDots />
                    <span>模型正在思考中，请稍候...</span>
                  </div>
                </div>
              ) : generationMessage ? (
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <ThinkingDonutSpinner className="size-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>{generationMessage}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <ThinkingDonutSpinner className="size-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
                  <span>正在生成回答...</span>
                </div>
              )}
            </div>
          </div>
          )}

          {!hasAnyStage && (
            <div className="flex items-center gap-2 border border-dashed border-slate-200/90 bg-slate-50/50 px-2.5 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
              <ThinkingDonutSpinner className="size-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
              <span className="animate-pulse-soft">等待思考阶段…</span>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
