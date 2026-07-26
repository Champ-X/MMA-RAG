import { useId, useState } from 'react'
import { Brain, Network, Search, ChevronDown, ChevronRight, CheckCircle, AlertCircle, Image as ImageIcon, Music, Video, Sparkles, FileText, Wand2, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThoughtData, ThinkingState } from '@/store/useChatStore'
import type { AgentRoundTrace } from '@/types/sse'

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
    <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400" role="status" aria-live="polite">
      <ThinkingDonutSpinner className="size-3" />
      <span className="text-[10px] font-medium animate-pulse-soft">{text}</span>
    </span>
  )
}

/** 不确定进度：色块往复滑动 + 高光扫过 */
function IndeterminateThinkingBar() {
  return (
    <div
      className="relative h-1.5 overflow-hidden bg-slate-200/80 shadow-inner dark:bg-slate-800/80"
      role="progressbar"
      aria-label="思考处理中"
    >
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
  const capsuleId = useId().replace(/:/g, '')
  const contentId = `${capsuleId}-thinking-capsule-content`

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
    agentModeAuto: thoughtData?.agent_mode_auto,
    agentModeSelected: thoughtData?.agent_mode_selected,
    agentModeReason: thoughtData?.agent_mode_reason,
  }

  const routing = thoughtData?.target_kbs || (thoughtData?.fallback_search ? { strategy: 'fallback' as const } : thoughtData?.target_kbs ? undefined : { strategy: 'weighted' as const })

  const retrieval = {
    keywords: thoughtData?.sparse_keywords || [],
    subQueries: thoughtData?.sub_queries || [],
    totalFound: thoughtData?.total_found,
    reranked: thoughtData?.reranked_count,
    agentMode: thoughtData?.agent_mode,
    agentRound: thoughtData?.agent_round,
    agentReason: thoughtData?.agent_reason,
    agentNewEvidence: thoughtData?.agent_new_evidence,
    targetKbs: thoughtData?.target_kbs || [],
  }

  // 获取生成阶段的状态信息
  // 如果生成已完成，强制清除状态信息，避免显示旧的动效
  // 检查 message.thinking 中的完成标记
  const isGenerationFailed = stages?.generation === 'failed' || thoughtData?._generation_failed === true
  const isGenerationCompleted = !isGenerationFailed && (stages?.generation === 'completed' || thoughtData?._generation_completed === true)
  const generationStatus = isGenerationCompleted
    ? null 
    : (thoughtData?.generation_status || thoughtData?.status)
  const generationMessage = isGenerationCompleted
    ? ''
    : (thoughtData?.generation_message || thoughtData?.message || '')

  const isAgentMode =
    thoughtData?.agent_mode === true ||
    thoughtData?.intent_type === 'agentic' ||
    thoughtData?.agent_mode_selected === 'agent'
  const agentActive = isAgentMode
  const legacyAgentRound: AgentRoundTrace[] =
    (retrieval.agentRound ?? 0) > 0 && retrieval.subQueries.length > 0
      ? [{
          round: retrieval.agentRound ?? 1,
          action: 'search',
          status: retrieval.totalFound != null || retrieval.agentNewEvidence != null ? 'completed' : 'processing',
          reason: retrieval.agentReason || '',
          queries: retrieval.subQueries,
          result_count: retrieval.reranked ?? retrieval.totalFound ?? 0,
          new_evidence_count: retrieval.agentNewEvidence ?? retrieval.totalFound ?? 0,
          total_evidence_count: retrieval.totalFound ?? 0,
          target_kbs: retrieval.targetKbs,
          duration_seconds: 0,
        }]
      : []
  const agentRounds = thoughtData?.agent_rounds?.length
    ? thoughtData.agent_rounds
    : legacyAgentRound
  const latestAgentRound = agentRounds[agentRounds.length - 1]
  const agentPlanReady = agentRounds.length > 0
  const agentRoundFailed = latestAgentRound?.status === 'failed'
  const agentEvidenceReady =
    latestAgentRound?.status === 'completed' || latestAgentRound?.status === 'failed'

  // 有 stages 时按阶段流式展示；无 stages（如历史消息）时按 thoughtData 有则展示
  const intentActive =
    !isAgentMode &&
    (
      (stages?.intent && stages.intent !== 'idle') ||
      (!!thoughtData && (
        !!thoughtData.intent_type ||
        !!thoughtData.original_query ||
        !!thoughtData.refined_query ||
        thoughtData.agent_mode_auto === true
      ))
    )
  const routingActive =
    !isAgentMode &&
    (
      (stages?.routing && stages.routing !== 'idle') ||
      (!!thoughtData && (Array.isArray(thoughtData.target_kbs) || thoughtData.fallback_search === true))
    )
  const retrievalActive =
    !isAgentMode &&
    (
      (stages?.retrieval && stages.retrieval !== 'idle') ||
      (!!thoughtData && ((thoughtData.sparse_keywords?.length ?? 0) > 0 || (thoughtData.sub_queries?.length ?? 0) > 0 || thoughtData.total_found != null))
    )
  // 生成阶段只有在以下情况才显示：
  // 1. 明确收到 generation 阶段的事件（currentStage === 'generation'）
  // 2. 或者生成阶段状态为 processing 或 completed
  // 3. 或者有明确的生成状态信息
  // 4. 或者从 message.thinking 中检测到完成标记
  // 注意：检索阶段完成时，不应该显示生成阶段，直到明确收到 generation 事件
  const generationActive =
    isGenerationFailed
      ? true
      : isGenerationCompleted || stages?.generation === 'completed' // 已完成时也要显示完成状态
      ? true
      : (currentStage === 'generation' && stages?.generation !== 'idle') || // 必须是 generation 阶段且状态不是 idle
        (stages?.generation === 'processing') || // 或者明确是 processing 状态
        (!!generationStatus && currentStage === 'generation') // 或者有生成状态且当前阶段是 generation
  const hasAnyStage = agentActive || intentActive || routingActive || retrievalActive || generationActive

  const stageLabel = (status: StageStatus) =>
    status === 'processing' ? '进行中…' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : ''

  // 折叠时展示的阶段摘要：意图解析 ✓ · 智能路由 ✓ · 检索中…
  const summaryParts: string[] = []
  if (agentActive) {
    summaryParts.push(
      agentRoundFailed
        ? `Agent 第 ${latestAgentRound?.round ?? retrieval.agentRound ?? 1} 轮失败`
        : agentEvidenceReady
        ? `Agent 第 ${latestAgentRound?.round ?? retrieval.agentRound ?? 1} 轮 ✓`
        : agentPlanReady
          ? `Agent 第 ${latestAgentRound?.round ?? retrieval.agentRound ?? 1} 轮检索中…`
          : 'Agent 正在规划…'
    )
  } else {
    if (intentActive) {
      summaryParts.push(stages?.intent === 'completed' ? '意图解析 ✓' : stages?.intent === 'processing' ? '意图解析…' : '意图解析 ✓')
    }
    if (routingActive) {
      summaryParts.push(stages?.routing === 'completed' ? '智能路由 ✓' : stages?.routing === 'processing' ? '智能路由…' : '智能路由 ✓')
    }
    if (retrievalActive) {
      summaryParts.push(stages?.retrieval === 'completed' ? '检索 ✓' : stages?.retrieval === 'processing' ? '检索中…' : '检索 ✓')
    }
  }
  if (generationActive) {
    summaryParts.push(isGenerationFailed ? '生成失败' : stages?.generation === 'completed' ? '生成 ✓' : stages?.generation === 'processing' ? '生成中…' : '生成 ✓')
  }
  /** 各阶段底色区分；当前阶段左侧加强调条 */
  const stageSkin = {
    agent: {
      bg: 'bg-violet-50/90 dark:bg-violet-950/25',
      bgCurrent: 'bg-violet-100/95 dark:bg-violet-950/40',
      bar: 'border-l-violet-500 dark:border-l-violet-400',
      icon: 'text-violet-600 dark:text-violet-400',
    },
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
    'inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold tracking-wide shadow-sm transition-[transform,box-shadow] duration-200 hover:shadow-md'
  const summaryLine = summaryParts.length > 0 ? summaryParts.join(' · ') : null
  const visibleStageCount = [agentActive, intentActive, routingActive, retrievalActive, generationActive].filter(Boolean).length
  const thinkingStatusText = summaryLine || (hasAnyStage ? `已显示 ${visibleStageCount} 个思考阶段` : '等待思考阶段')
  const capsuleTitle = isAgentMode ? 'Agent 深研过程' : '思考过程'
  const normalizeCollapsedStatus = (
    status: StageStatus | undefined,
    fallback: Exclude<StageStatus, 'idle'> = 'completed'
  ): Exclude<StageStatus, 'idle'> =>
    status === 'processing' || status === 'completed' || status === 'failed'
      ? status
      : fallback
  const collapsedStages: Array<{
    label: string
    status: Exclude<StageStatus, 'idle'>
  }> = []

  if (agentActive) {
    collapsedStages.push({
      label: agentPlanReady ? `第 ${latestAgentRound?.round ?? retrieval.agentRound ?? 1} 轮` : '规划',
      status: agentRoundFailed ? 'failed' : agentEvidenceReady ? 'completed' : 'processing',
    })
  } else {
    if (intentActive) {
      collapsedStages.push({ label: '意图', status: normalizeCollapsedStatus(stages?.intent) })
    }
    if (routingActive) {
      collapsedStages.push({ label: '路由', status: normalizeCollapsedStatus(stages?.routing) })
    }
    if (retrievalActive) {
      collapsedStages.push({ label: '检索', status: normalizeCollapsedStatus(stages?.retrieval) })
    }
  }
  if (generationActive) {
    collapsedStages.push({
      label: '生成',
      status: isGenerationFailed
        ? 'failed'
        : normalizeCollapsedStatus(stages?.generation),
    })
  }
  const collapsedOverallStatus: Exclude<StageStatus, 'idle'> = collapsedStages.some(
    (stage) => stage.status === 'failed'
  )
    ? 'failed'
    : collapsedStages.some((stage) => stage.status === 'processing')
      ? 'processing'
      : 'completed'

  return (
    <div
      className={cn(
        'group/capsule w-full overflow-hidden border transition-[background-color,border-color,box-shadow] duration-200',
        open
          ? 'rounded-xl border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/70 dark:bg-slate-950 dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
          : 'rounded-[14px] border-indigo-100/90 bg-white/90 shadow-[0_10px_28px_-24px_rgba(51,65,85,0.48)] hover:border-indigo-200 hover:bg-white hover:shadow-[0_14px_32px_-24px_rgba(79,70,229,0.28)] dark:border-indigo-400/15 dark:bg-slate-900/90 dark:shadow-[0_12px_30px_-24px_rgba(0,0,0,0.9)] dark:hover:border-indigo-400/30 dark:hover:bg-slate-900'
      )}
      role="region"
      aria-label={capsuleTitle}
    >
      <span className="sr-only" aria-live="polite">
        {thinkingStatusText}
      </span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${open ? '折叠' : '展开'}${capsuleTitle}${summaryLine ? `：${summaryLine}` : ''}`}
        className={cn(
          'relative flex w-full items-center text-left text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/70',
          open
            ? 'gap-2.5 border-b border-slate-200/80 bg-slate-50/90 px-3 py-2 text-slate-700 hover:bg-slate-100/90 dark:border-slate-700/80 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-900/90'
            : 'min-h-12 gap-3 bg-transparent px-3 py-2.5 text-slate-700 dark:text-slate-100'
        )}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center',
            open
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'size-8 rounded-[10px] bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 transition-colors group-hover/capsule:bg-indigo-100/75 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/15 dark:group-hover/capsule:bg-indigo-500/15 max-[400px]:hidden'
          )}
          aria-hidden
        >
          <Brain size={open ? 15 : 14} strokeWidth={2} />
        </span>
        <span className="shrink-0 text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          {capsuleTitle}
        </span>
        {!open && collapsedStages.length > 0 && (
          <>
            <span className="h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700 max-[400px]:hidden" aria-hidden />
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="inline-flex max-w-full items-center rounded-[10px] bg-slate-100/80 px-2.5 py-1.5 ring-1 ring-inset ring-slate-200/65 dark:bg-slate-800/70 dark:ring-slate-700/80 max-[480px]:hidden">
                {collapsedStages.map((stage, index) => (
                  <span key={`${stage.label}-${index}`} className="contents">
                    {index > 0 && (
                      <span
                        className="mx-1.5 h-px w-2.5 shrink-0 bg-slate-300 dark:bg-slate-600"
                        aria-hidden
                      />
                    )}
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold leading-4',
                        stage.status === 'completed' && 'text-emerald-700 dark:text-emerald-300',
                        stage.status === 'processing' && 'text-indigo-700 dark:text-indigo-300',
                        stage.status === 'failed' && 'text-rose-700 dark:text-rose-300'
                      )}
                    >
                      {stage.status === 'completed' ? (
                        <CheckCircle size={12} strokeWidth={2.25} aria-hidden />
                      ) : stage.status === 'failed' ? (
                        <AlertCircle size={12} strokeWidth={2.25} aria-hidden />
                      ) : (
                        <ThinkingDonutSpinner className="size-3" />
                      )}
                      <span>{stage.label}</span>
                    </span>
                  </span>
                ))}
              </span>
              <span
                className={cn(
                  'hidden h-7 items-center gap-1.5 rounded-[9px] px-2 text-[11px] font-semibold ring-1 ring-inset max-[480px]:inline-flex',
                  collapsedOverallStatus === 'completed' && 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/15',
                  collapsedOverallStatus === 'processing' && 'bg-indigo-50 text-indigo-700 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/15',
                  collapsedOverallStatus === 'failed' && 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/15'
                )}
              >
                {collapsedOverallStatus === 'completed' ? (
                  <CheckCircle size={12} strokeWidth={2.25} aria-hidden />
                ) : collapsedOverallStatus === 'failed' ? (
                  <AlertCircle size={12} strokeWidth={2.25} aria-hidden />
                ) : (
                  <ThinkingDonutSpinner className="size-3" />
                )}
                <span>{collapsedStages.length} 阶段</span>
              </span>
            </span>
          </>
        )}
        <span
          className={cn(
            'ml-auto flex shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200',
            open
              ? 'size-7 rounded-[8px] border border-slate-200/70 bg-white text-slate-500 group-hover/capsule:scale-[1.02] dark:border-slate-600/70 dark:bg-slate-900 dark:text-slate-400'
              : 'h-8 gap-1 rounded-[10px] bg-indigo-50 px-2.5 text-[11px] font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-100 group-hover/capsule:translate-x-0.5 group-hover/capsule:bg-indigo-100/80 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/15 dark:group-hover/capsule:bg-indigo-500/15'
          )}
        >
          {open ? (
            <ChevronDown size={14} strokeWidth={2.25} aria-hidden />
          ) : (
            <>
              <span className="hidden lg:inline">展开</span>
              <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
            </>
          )}
        </span>
      </button>
      {open && (
        <div
          id={contentId}
          className="border-t border-slate-100/90 bg-slate-50/30 px-3 pb-2 pt-0 dark:border-slate-800/80 dark:bg-slate-950/40 sm:px-3.5"
          role="region"
          aria-label={`${capsuleTitle}详情`}
          aria-live="polite"
        >
          <div className="flex flex-col">
          {agentActive && (
          <section
            className={stageBlockClass('agent', currentStage === 'agent')}
            aria-label={`Agent 深研，${agentRoundFailed ? '本轮检索失败' : agentEvidenceReady ? '本轮证据检索完成' : agentPlanReady ? '正在执行检索' : '正在制定研究计划'}`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Sparkles size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.agent.icon)} aria-hidden />
              <span className="tracking-tight">Agent 深研</span>
              {agentRoundFailed ? (
                <span className="text-[10px] text-rose-600 dark:text-rose-400">本轮失败</span>
              ) : agentEvidenceReady ? (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">本轮完成</span>
              ) : (
                <StageProcessingCue text={agentPlanReady ? '检索中…' : '规划中…'} />
              )}
              {latestAgentRound && (
                <span className="ml-auto rounded-full border border-violet-200/80 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/50 dark:text-violet-200">
                  共 {agentRounds.length} 轮
                </span>
              )}
            </div>
            <div className="ml-0.5 space-y-2 border-l border-violet-300/60 pl-2.5 dark:border-violet-600/50 sm:pl-3">
              {intent.agentModeAuto && intent.agentModeReason && (
                <p className="text-[10px] leading-relaxed text-violet-700/80 dark:text-violet-300/80">
                  自动选择 Agent 深研：{intent.agentModeReason}
                </p>
              )}

              {!agentPlanReady ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-200">
                    <ThinkingDonutSpinner className="size-3.5" />
                    <span className="animate-pulse-soft">正在拆解问题并制定研究计划…</span>
                  </div>
                  <IndeterminateThinkingBar />
                </div>
              ) : (
                <div className="relative space-y-2 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-violet-200 dark:before:bg-violet-700/60" aria-label="Agent 多轮研究日志">
                  {agentRounds.map((round) => {
                    const roundFailed = round.status === 'failed'
                    const roundProcessing = round.status === 'processing'
                    return (
                      <article
                        key={round.round}
                        className={cn(
                          'relative ml-7 rounded-lg border px-3 py-2.5 shadow-sm',
                          roundProcessing
                            ? 'border-violet-300 bg-white/90 dark:border-violet-500/50 dark:bg-violet-950/35'
                            : roundFailed
                              ? 'border-rose-200 bg-rose-50/75 dark:border-rose-700/50 dark:bg-rose-950/25'
                              : 'border-slate-200/90 bg-white/75 dark:border-slate-700 dark:bg-slate-900/55'
                        )}
                        aria-label={`Agent 第 ${round.round} 轮，${roundProcessing ? '检索中' : roundFailed ? '失败' : '已完成'}`}
                      >
                        <span
                          className={cn(
                            'absolute -left-[29px] top-2.5 flex size-[22px] items-center justify-center rounded-full border text-[9px] font-bold shadow-sm',
                            roundProcessing
                              ? 'border-violet-400 bg-violet-600 text-white'
                              : roundFailed
                                ? 'border-rose-300 bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          )}
                          aria-hidden
                        >
                          {round.round}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                            第 {round.round} 轮
                          </span>
                          {roundProcessing ? (
                            <StageProcessingCue text="检索中…" />
                          ) : roundFailed ? (
                            <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">检索失败</span>
                          ) : (
                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已完成</span>
                          )}
                          {round.duration_seconds > 0 && !roundProcessing && (
                            <span className="ml-auto text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
                              {round.duration_seconds.toFixed(1)}s
                            </span>
                          )}
                        </div>

                        {round.reason && (
                          <p className="mt-1.5 text-[10px] leading-relaxed text-violet-800/90 dark:text-violet-200/90">
                            {round.reason}
                          </p>
                        )}

                        <div className="mt-2 space-y-1.5" aria-label={`第 ${round.round} 轮子查询`}>
                          {round.queries.map((query, index) => (
                            <div key={`${round.round}-${query}-${index}`} className="flex items-start gap-2 text-[10px] text-slate-700 dark:text-slate-300">
                              {roundProcessing ? (
                                <ThinkingDonutSpinner className="mt-0.5 size-2.5 shrink-0 text-violet-500 dark:text-violet-400" />
                              ) : roundFailed ? (
                                <AlertCircle size={11} className="mt-0.5 shrink-0 text-rose-500" aria-hidden />
                              ) : (
                                <CheckCircle size={11} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden />
                              )}
                              <span className="leading-relaxed">{query}</span>
                            </div>
                          ))}
                        </div>

                        {!roundProcessing && (
                          <div
                            className={cn(
                              'mt-2 space-y-1.5 rounded-md border px-2.5 py-2 text-[10px]',
                              roundFailed
                                ? 'border-rose-200/80 bg-rose-50/90 text-rose-800 dark:border-rose-700/50 dark:bg-rose-950/30 dark:text-rose-200'
                                : 'border-emerald-200/80 bg-emerald-50/90 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-200'
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              {roundFailed ? <AlertCircle size={13} aria-hidden /> : <CheckCircle size={13} aria-hidden />}
                              <span className="font-semibold">{roundFailed ? '本轮未获得证据' : '本轮证据已汇总'}</span>
                              {!roundFailed && (
                                <span>
                                  新增 {round.new_evidence_count} 条，累计 {round.total_evidence_count} 条
                                </span>
                              )}
                            </div>
                            {round.error && (
                              <p className="break-words leading-relaxed">{round.error}</p>
                            )}
                            {round.target_kbs.length > 0 && (
                              <div className="flex items-start gap-1.5 border-t border-current/15 pt-1.5">
                                <span className="shrink-0 opacity-70">来源知识库</span>
                                <span className="font-medium">
                                  {round.target_kbs.map(kb => kb.name || kb.id).join('、')}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
          )}

          {/* 阶段一：意图解析 — 仅在该阶段开始后展示，流式更新 */}
          {intentActive && (
          <section className={stageBlockClass('intent', currentStage === 'intent')} aria-label={`意图解析阶段，${stageLabel(stages?.intent ?? 'completed') || '已展示'}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Target size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.intent.icon)} aria-hidden />
              <span className="tracking-tight">意图解析</span>
              {stages?.intent === 'processing' && !intent.type && !intent.originalQuery && (
                <StageProcessingCue text={stageLabel(stages.intent)} />
              )}
              {stages?.intent === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {intent.agentModeAuto && intent.agentModeSelected && (
                <div className="mb-1.5 rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-2.5 py-2 dark:border-indigo-500/30 dark:bg-indigo-950/30">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-800 dark:text-indigo-200">
                    <Wand2 size={12} aria-hidden />
                    <span>
                      自动选择：
                      {intent.agentModeSelected === 'agent' ? 'Agent 深研' : '直接检索'}
                    </span>
                  </div>
                  {intent.agentModeReason && (
                    <p className="mt-1 text-[10px] leading-relaxed text-indigo-700/80 dark:text-indigo-300/80">
                      {intent.agentModeReason}
                    </p>
                  )}
                </div>
              )}
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
                      <ImageIcon size={11} strokeWidth={2.25} aria-hidden />
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
                      <Music size={11} strokeWidth={2.25} aria-hidden />
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
                      <Video size={11} strokeWidth={2.25} aria-hidden />
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
          </section>
          )}

          {/* 阶段二：智能路由 — 路由阶段开始后展示 */}
          {routingActive && (
          <section className={stageBlockClass('routing', currentStage === 'routing')} aria-label={`智能路由阶段，${stageLabel(stages?.routing ?? 'completed') || '已展示'}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Network size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.routing.icon)} aria-hidden />
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
                routing.map((kb, idx) => {
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
          </section>
          )}

          {/* 阶段三：检索策略 — 检索阶段开始后展示 */}
          {retrievalActive && (
          <section className={stageBlockClass('retrieval', currentStage === 'retrieval')} aria-label={`检索策略阶段，${stageLabel(stages?.retrieval ?? 'completed') || '已展示'}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Search size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.retrieval.icon)} aria-hidden />
              <span className="tracking-tight">检索策略</span>
              {stages?.retrieval === 'processing' && retrieval.keywords.length === 0 && !retrieval.subQueries?.length && retrieval.totalFound == null && (
                <StageProcessingCue text={stageLabel(stages.retrieval)} />
              )}
              {stages?.retrieval === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {retrieval.agentMode && (
                <div className="mb-1.5 rounded-lg border border-violet-200/80 bg-violet-50/80 px-2.5 py-2 dark:border-violet-500/30 dark:bg-violet-950/30">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-violet-800 dark:text-violet-200">
                    <Sparkles size={12} aria-hidden />
                    <span>Agent 第 {retrieval.agentRound ?? 1} 轮</span>
                    {retrieval.agentNewEvidence != null && (
                      <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/50 dark:text-violet-200">
                        +{retrieval.agentNewEvidence} 条新证据
                      </span>
                    )}
                  </div>
                  {retrieval.agentReason && (
                    <p className="mt-1 text-[10px] leading-relaxed text-violet-700/80 dark:text-violet-300/80">
                      {retrieval.agentReason}
                    </p>
                  )}
                </div>
              )}
              {retrieval.keywords.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">关键词</span>
                  <div className="flex flex-1 flex-wrap gap-1">
                    {retrieval.keywords.map((kw: string, idx: number) => (
                      <span
                        key={idx}
                        className="cursor-default rounded-[6px] border border-sky-200/90 bg-sky-50/90 px-2 py-0.5 text-[10px] font-semibold text-sky-800 shadow-sm transition-shadow duration-200 hover:shadow dark:border-sky-500/35 dark:bg-sky-950/40 dark:text-sky-200"
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
                        <CheckCircle size={10} className="text-green-500 flex-shrink-0" aria-hidden />
                        <span className="text-slate-600 dark:text-slate-300 text-[10px]">{sq}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {retrieval.totalFound !== undefined && retrieval.totalFound !== null && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-20 flex-shrink-0 text-slate-400 dark:text-slate-500">结果</span>
                  <span className="rounded-md border border-slate-200/80 bg-white/90 px-2 py-0.5 text-[11px] leading-snug text-slate-700 shadow-sm dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-200">
                    检索到 {retrieval.totalFound} 个片段
                    {retrieval.reranked !== undefined && retrieval.reranked !== null
                      ? `，重排后保留 Top ${retrieval.reranked}`
                      : ''}
                  </span>
                </div>
              )}
            </div>
          </section>
          )}

          {/* 阶段四：生成回答 — 只有在明确收到 generation 事件后才显示 */}
          {generationActive && (
          <section className={stageBlockClass('generation', currentStage === 'generation')} aria-label={`生成回答阶段，${isGenerationFailed ? '失败' : stageLabel(stages?.generation ?? 'completed') || '已展示'}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Sparkles size={14} strokeWidth={2.25} className={cn('shrink-0', stageSkin.generation.icon)} aria-hidden />
              <span className="tracking-tight">生成回答</span>
              {stages?.generation === 'processing' && (
                <StageProcessingCue text={stageLabel(stages.generation)} />
              )}
              {stages?.generation === 'completed' && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">{stageLabel('completed')}</span>
              )}
              {isGenerationFailed && (
                <span className="text-rose-600 dark:text-rose-400 text-[10px]">{stageLabel('failed')}</span>
              )}
            </div>
            <div className="ml-0.5 space-y-1 border-l border-slate-300/60 pl-2.5 dark:border-slate-600/50 sm:pl-3">
              {/* 生成完成后，隐藏动效，只显示完成状态 */}
              {isGenerationFailed ? (
                <div className="relative flex items-start gap-2.5 overflow-hidden rounded-md border border-rose-200/80 bg-rose-50/95 px-2.5 py-2 shadow-sm dark:border-rose-700/50 dark:bg-rose-950/35">
                  <span className="absolute bottom-0 left-0 top-0 w-0.5 bg-rose-500 dark:bg-rose-400" aria-hidden />
                  <AlertCircle className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" size={17} strokeWidth={2.25} aria-hidden />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold text-rose-800 dark:text-rose-200">回答生成失败</span>
                    <span className="break-words text-[10px] leading-relaxed text-rose-700/80 dark:text-rose-300/80">
                      {thoughtData?.generation_error || '模型服务暂时不可用，请检查配置后重试。'}
                    </span>
                  </div>
                </div>
              ) : isGenerationCompleted || stages?.generation === 'completed' ? (
                <div className="relative flex items-center gap-2.5 overflow-hidden rounded-md border border-emerald-200/80 bg-emerald-50/95 px-2.5 py-2 shadow-sm dark:border-emerald-700/50 dark:bg-emerald-950/35">
                  <span className="absolute bottom-0 left-0 top-0 w-0.5 bg-emerald-500 dark:bg-emerald-400" aria-hidden />
                  <CheckCircle className="shrink-0 text-emerald-600 dark:text-emerald-400" size={18} strokeWidth={2.25} aria-hidden />
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
                    <FileText size={14} className="shrink-0 text-purple-500 animate-pulse-soft dark:text-purple-400" aria-hidden />
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
                      aria-hidden
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
          </section>
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
