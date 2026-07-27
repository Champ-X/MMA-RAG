import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  AudioLines,
  Boxes,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  Image,
  Layers3,
  ListTree,
  Pause,
  Play,
  Search,
  Send,
  Sparkles,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type JourneyId = 'ingestion' | 'retrieval'
type FlowTone = 'cyan' | 'green' | 'violet' | 'coral'
type StepStatus = 'upcoming' | 'active' | 'complete'

interface FlowStep {
  id: string
  marker: string
  title: string
  short: string
  description: string
  signal: string
  detail: string
  tone: FlowTone
  icon: LucideIcon
}

interface Journey {
  label: string
  eyebrow: string
  title: string
  description: string
  steps: FlowStep[]
}

const journeys: Record<JourneyId, Journey> = {
  ingestion: {
    label: '多模态数据解析',
    eyebrow: 'WRITE PATH · MODAL-NATIVE INGESTION',
    title: '每种素材先按自己的语言被理解',
    description: '从文件进入，到对象与索引落盘；文档、图片、音频和视频不会被强行压成同一种文本。',
    steps: [
      {
        id: 'receive',
        marker: '01',
        title: '接入来源',
        short: '文件进入工作台',
        description: '上传、URL、文件夹或外部内容先被固化成可追溯原始对象，保留文件名、来源与媒体类型。',
        signal: 'source manifest',
        detail: 'Document · Image · Audio · Video',
        tone: 'coral',
        icon: Boxes,
      },
      {
        id: 'parse',
        marker: '02',
        title: '按模态解析',
        short: '各走各的理解器',
        description: '文档识别结构，图片生成视觉描述，音频提取转写与声学线索，视频拆成 Scene、Shot 与关键帧。',
        signal: 'modal parser',
        detail: 'Structure · VLM · ASR · Scene / Shot',
        tone: 'cyan',
        icon: BrainCircuit,
      },
      {
        id: 'shape',
        marker: '03',
        title: '形成语义单元',
        short: '可定位、可引用',
        description: '解析结果被组织为段落、caption、转写片段和视频 Shot；每个单元都保留回到原始素材的定位。',
        signal: 'evidence units',
        detail: 'Chunk · Caption · Transcript · Shot',
        tone: 'green',
        icon: ListTree,
      },
      {
        id: 'encode',
        marker: '04',
        title: '并行编码索引',
        short: '语义与专用向量',
        description: '文本 Dense / Sparse 与图片、音频、视频的专用向量并行计算，让每种检索通道各自保有最合适的表示。',
        signal: 'parallel vectors',
        detail: 'Dense · Sparse · CLIP · CLAP · Shot',
        tone: 'violet',
        icon: Layers3,
      },
      {
        id: 'persist',
        marker: '05',
        title: '落盘并可检索',
        short: '对象层 + 索引层',
        description: '原始对象、关键帧与 manifest 写入 MinIO；命名向量和稀疏索引进入 Qdrant，等待下一次问题读取。',
        signal: 'retrieval ready',
        detail: 'MinIO objects + Qdrant collections',
        tone: 'green',
        icon: Database,
      },
    ],
  },
  retrieval: {
    label: '多模态检索全链路',
    eyebrow: 'READ PATH · EVIDENCE FIRST',
    title: '一个问题，多个通道，同时寻找同一份证据',
    description: '从问题与范围进入，到引用答案离开；并行召回、融合排序与引用映射始终围绕可核验的证据合同。',
    steps: [
      {
        id: 'question',
        marker: '01',
        title: '接收问题与范围',
        short: '问题不会脱离上下文',
        description: '会话历史、知识库范围、指定文件与附件一起进入；范围约束会原样透传到后续每条子查询。',
        signal: 'query envelope',
        detail: 'Question · Session · KB / File scope',
        tone: 'coral',
        icon: Search,
      },
      {
        id: 'understand',
        marker: '02',
        title: '理解与路由',
        short: '改写 · 意图 · 画像',
        description: '系统补全检索表达、识别文本/图片/音频/视频意图，并在未指定范围时用知识库画像确定候选空间。',
        signal: 'retrieval plan',
        detail: 'Refined query · Intent · KB routing',
        tone: 'cyan',
        icon: BrainCircuit,
      },
      {
        id: 'recall',
        marker: '03',
        title: '五路并行召回',
        short: '每个模态各取所长',
        description: 'Dense、Sparse、Visual、Audio 与 Video Shot 在同一范围内并发工作，返回各自最擅长发现的候选证据。',
        signal: 'parallel recall',
        detail: 'Dense · Sparse · Visual · Audio · Video',
        tone: 'violet',
        icon: Layers3,
      },
      {
        id: 'rank',
        marker: '04',
        title: '融合与精排',
        short: 'RRF → Cross-Encoder',
        description: '加权 RRF 先让不可比的通道分数进入同一候选池，再由 Cross-Encoder 根据问题与证据的匹配度排序。',
        signal: 'ranked evidence',
        detail: 'Weighted RRF · Cross-Encoder',
        tone: 'green',
        icon: Sparkles,
      },
      {
        id: 'contract',
        marker: '05',
        title: '组装证据合同',
        short: 'RetrievalResult',
        description: '排好序的内容、来源、媒体 URL、页码或时间范围被统一封装；Direct 与 Agent 都在这里交会。',
        signal: 'evidence contract',
        detail: 'RetrievalResult · ReferenceMap',
        tone: 'cyan',
        icon: Boxes,
      },
      {
        id: 'answer',
        marker: '06',
        title: '带引用送达',
        short: 'thought → citation → message',
        description: '生成器只消费已排序证据，随后通过 SSE 依次交付思考摘要、引用与正文；来源从一开始就可回看。',
        signal: 'cited answer',
        detail: 'Context budget · Citation · SSE',
        tone: 'coral',
        icon: Send,
      },
    ],
  },
}

const toneStyles: Record<FlowTone, { dot: string; badge: string; node: string; icon: string }> = {
  cyan: {
    dot: 'bg-[#2f7f93]',
    badge: 'border-[#9ec7cf] bg-[#e4f3f4] text-[#236d7e] dark:border-[#326875] dark:bg-[#2f7f93]/15 dark:text-[#8cd2dc]',
    node: 'border-[#9bc6cd] bg-[#e4f0f1] dark:border-[#35606b] dark:bg-[#2f7f93]/12',
    icon: 'text-[#2f7f93] dark:text-[#8ad1db]',
  },
  green: {
    dot: 'bg-[#5f8e72]',
    badge: 'border-[#b3cdb9] bg-[#e8f2e8] text-[#4c7a60] dark:border-[#3f664d] dark:bg-[#5f8e72]/15 dark:text-[#99c9a7]',
    node: 'border-[#abc8b4] bg-[#e8f0e8] dark:border-[#3c624a] dark:bg-[#5f8e72]/12',
    icon: 'text-[#5f8e72] dark:text-[#9bcaab]',
  },
  violet: {
    dot: 'bg-[#765c95]',
    badge: 'border-[#c7b9d5] bg-[#f0ebf4] text-[#765c95] dark:border-[#614d79] dark:bg-[#765c95]/15 dark:text-[#c8b4df]',
    node: 'border-[#c7b9d5] bg-[#eee9f2] dark:border-[#604d75] dark:bg-[#765c95]/12',
    icon: 'text-[#765c95] dark:text-[#c7b4de]',
  },
  coral: {
    dot: 'bg-[#e47b4e]',
    badge: 'border-[#ebbeaa] bg-[#f9ede5] text-[#c8633b] dark:border-[#794d38] dark:bg-[#e47b4e]/15 dark:text-[#f1ae8d]',
    node: 'border-[#e5b49c] bg-[#f6e7dd] dark:border-[#764a37] dark:bg-[#e47b4e]/12',
    icon: 'text-[#d66d41] dark:text-[#efad8c]',
  },
}

export function InteractiveFlowStudio() {
  const [journeyId, setJourneyId] = useState<JourneyId>('ingestion')
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [autoPlaying, setAutoPlaying] = useState(false)
  const journey = journeys[journeyId]
  const activeStep = journey.steps[activeStepIndex]
  const isLastStep = activeStepIndex === journey.steps.length - 1

  useEffect(() => {
    if (!autoPlaying || isLastStep) return
    const timer = window.setTimeout(() => setActiveStepIndex((current) => current + 1), 1700)
    return () => window.clearTimeout(timer)
  }, [autoPlaying, activeStepIndex, isLastStep])

  useEffect(() => {
    if (autoPlaying && isLastStep) setAutoPlaying(false)
  }, [autoPlaying, isLastStep])

  const selectJourney = (nextJourney: JourneyId) => {
    setJourneyId(nextJourney)
    setActiveStepIndex(0)
    setAutoPlaying(false)
  }

  const statusFor = (stepIndex: number): StepStatus => {
    if (stepIndex < activeStepIndex) return 'complete'
    if (stepIndex === activeStepIndex) return 'active'
    return 'upcoming'
  }

  return (
    <section id="flow-lab" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(31rem,1.22fr)] lg:items-end lg:gap-14">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">Interactive flow lab</p>
          <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
            把静态架构，变成能亲手推进的证据旅程
          </h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px] lg:justify-self-end">
          选择一条链路，点击任一步，或者用“上一步 / 下一步”观察信号包如何流转。动画只标记此刻正在发生的工作，不会替代真实的系统边界。
        </p>
      </div>

      <div className="flow-lab-shell mt-9 overflow-hidden rounded-[30px] border border-[#b5cbc4] bg-[#e9f0ec] shadow-[0_36px_90px_-62px_rgba(16,45,66,0.82)] dark:border-[#2a4d59] dark:bg-[#0a202a]">
        <div className="flex flex-col gap-4 border-b border-[#c7d7d1] bg-[#f5f8f4]/75 p-4 dark:border-[#294b57] dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-[#718588] dark:text-[#86a3a5]">Choose a journey</p>
            <p className="mt-1 text-sm font-semibold text-[#17384a] dark:text-[#e5f0ed]">每次只演示一个可验证的流转动作</p>
          </div>
          <div role="tablist" aria-label="交互式架构演示" className="grid w-full grid-cols-2 rounded-full border border-[#bfd1ca] bg-[#e3ebe6] p-1 dark:border-[#31535f] dark:bg-[#071a24] sm:w-auto">
            {(Object.keys(journeys) as JourneyId[]).map((id) => {
              const selected = journeyId === id
              const isIngestion = id === 'ingestion'
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectJourney(id)}
                  className={cn(
                    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-3 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70 sm:px-4',
                    selected
                      ? isIngestion
                        ? 'bg-[#e47b4e] text-white shadow-[0_6px_16px_-10px_rgba(189,84,43,0.95)]'
                        : 'bg-[#102d42] text-white shadow-sm dark:bg-[#dcebe7] dark:text-[#102d42]'
                      : 'text-[#62787c] hover:text-[#16384a] dark:text-[#9bb1b3] dark:hover:text-white'
                  )}
                >
                  {isIngestion ? <Boxes className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{journeys[id].label}</span>
                  <span className="sm:hidden">{isIngestion ? '解析' : '检索'}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid xl:grid-cols-[19.5rem_minmax(0,1fr)]">
          <aside className="border-b border-[#c7d7d1] bg-white/30 p-4 dark:border-[#294b57] dark:bg-white/[0.018] sm:p-5 xl:border-b-0 xl:border-r xl:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6d8285] dark:text-[#8ca5a7]">Manual timeline</span>
              <span className={cn('rounded-full border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em]', toneStyles[activeStep.tone].badge)}>
                Step {activeStep.marker}
              </span>
            </div>
            <ol className="relative mt-4 space-y-1.5" aria-label={`${journey.label}步骤`}>
              <span className="absolute bottom-5 left-[1.1rem] top-5 w-px bg-[#bfcec8] dark:bg-[#31515c]" aria-hidden />
              {journey.steps.map((step, index) => (
                <li key={step.id} className="relative">
                  <TimelineStep
                    step={step}
                    status={statusFor(index)}
                    onSelect={() => {
                      setActiveStepIndex(index)
                      setAutoPlaying(false)
                    }}
                  />
                </li>
              ))}
            </ol>

            <div className="mt-5 flex items-center gap-2 border-t border-[#c7d7d1] pt-4 dark:border-[#294b57]">
              <button
                type="button"
                onClick={() => {
                  setActiveStepIndex((index) => Math.max(0, index - 1))
                  setAutoPlaying(false)
                }}
                disabled={activeStepIndex === 0}
                className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#bfd1ca] bg-white/60 px-2 text-xs font-semibold text-[#3d6268] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#31535f] dark:bg-white/[0.04] dark:text-[#b3c9c9] dark:hover:bg-white/[0.08]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一步
              </button>
              <button
                type="button"
                onClick={() => setAutoPlaying((playing) => !playing)}
                aria-pressed={autoPlaying}
                className={cn(
                  'inline-flex min-h-9 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70',
                  autoPlaying
                    ? 'border-[#cfb7df] bg-[#765c95] text-white'
                    : 'border-[#bfd1ca] bg-white/60 text-[#506e73] hover:bg-white dark:border-[#31535f] dark:bg-white/[0.04] dark:text-[#b3c9c9] dark:hover:bg-white/[0.08]'
                )}
                title={autoPlaying ? '暂停自动演示' : '自动播放演示'}
                aria-label={autoPlaying ? '暂停自动演示' : '自动播放演示'}
              >
                {autoPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveStepIndex((index) => Math.min(journey.steps.length - 1, index + 1))
                  setAutoPlaying(false)
                }}
                disabled={isLastStep}
                className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#102d42] px-2 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#dcebe7] dark:text-[#102d42]"
              >
                下一步
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-6 lg:p-7">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-[#72878a] dark:text-[#8da6a8]">{journey.eyebrow}</p>
                <h3 className="architecture-display mt-2 text-2xl font-semibold tracking-[-0.03em] text-[#102d42] dark:text-[#eff7f4] sm:text-[2rem]">{journey.title}</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5e7478] dark:text-[#a3b9bb]">{journey.description}</p>
              </div>
              <FlowNarrator step={activeStep} stepIndex={activeStepIndex} total={journey.steps.length} />
            </div>

            <div className="mt-6">
              {journeyId === 'ingestion' ? (
                <IngestionStage activeStepIndex={activeStepIndex} activeStep={activeStep} />
              ) : (
                <RetrievalStage activeStepIndex={activeStepIndex} activeStep={activeStep} />
              )}
            </div>

            <div className="mt-5 grid gap-3 rounded-[18px] border border-[#c5d6d0] bg-white/52 p-4 dark:border-[#294c57] dark:bg-white/[0.025] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border', toneStyles[activeStep.tone].node, toneStyles[activeStep.tone].icon)}>
                  <activeStep.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#193d4d] dark:text-[#e6f0ed]">{activeStep.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[#62797d] dark:text-[#9bb2b4]">{activeStep.description}</p>
                </div>
              </div>
              <div className="rounded-xl border border-[#c9d9d3] bg-[#eff5f1] px-3 py-2 font-mono text-[10px] leading-5 text-[#567277] dark:border-[#31525e] dark:bg-[#102a34] dark:text-[#aec3c4] sm:max-w-[14rem]">
                <span className="block text-[#2f7f93] dark:text-[#88cbd5]">{activeStep.signal}</span>
                {activeStep.detail}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TimelineStep({ step, status, onSelect }: { step: FlowStep; status: StepStatus; onSelect: () => void }) {
  const Icon = step.icon
  const active = status === 'active'
  const complete = status === 'complete'

  return (
    <button
      type="button"
      aria-current={active ? 'step' : undefined}
      onClick={onSelect}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70',
        active
          ? cn('shadow-[0_10px_20px_-18px_rgba(16,45,66,0.72)]', toneStyles[step.tone].node)
          : complete
            ? 'border-transparent bg-transparent hover:bg-white/45 dark:hover:bg-white/[0.035]'
            : 'border-transparent hover:border-[#c4d5cf] hover:bg-white/35 dark:hover:border-[#2d4e59] dark:hover:bg-white/[0.025]'
      )}
    >
      <span className={cn(
        'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#e9f0ec] text-[10px] font-bold transition-colors dark:border-[#0a202a]',
        active
          ? cn(toneStyles[step.tone].dot, 'text-white')
          : complete
            ? 'bg-[#5f8e72] text-white'
            : 'bg-[#c8d7d1] text-[#60777a] dark:bg-[#294c57] dark:text-[#93acad]'
      )}>
        {complete ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#799093] dark:text-[#839ea1]">{step.marker} · {step.short}</span>
        <span className="mt-0.5 block text-[12px] font-semibold text-[#1d4353] dark:text-[#deebe7]">{step.title}</span>
      </span>
    </button>
  )
}

function FlowNarrator({ step, stepIndex, total }: { step: FlowStep; stepIndex: number; total: number }) {
  const Icon = step.icon
  return (
    <div className={cn('relative overflow-hidden rounded-[20px] border p-4', toneStyles[step.tone].node)}>
      <div className="flow-lab-narrator-scan" aria-hidden />
      <div className="relative flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/55 bg-white/55 dark:border-white/10 dark:bg-white/[0.06]', toneStyles[step.tone].icon)}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[#668287] dark:text-[#a1b9ba]">Now running · {String(stepIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</p>
          <p className="mt-1 text-sm font-semibold text-[#193d4d] dark:text-[#edf6f2]">{step.signal}</p>
          <p className="mt-1 text-xs leading-5 text-[#557176] dark:text-[#b0c4c4]">{step.detail}</p>
        </div>
      </div>
    </div>
  )
}

function IngestionStage({ activeStepIndex, activeStep }: { activeStepIndex: number; activeStep: FlowStep }) {
  const sourceModes = [
    { label: '文档', detail: '结构', icon: FileText, tone: 'coral' as FlowTone },
    { label: '图片', detail: '视觉', icon: Image, tone: 'cyan' as FlowTone },
    { label: '音频', detail: '转写', icon: AudioLines, tone: 'violet' as FlowTone },
    { label: '视频', detail: '镜头', icon: Video, tone: 'green' as FlowTone },
  ]
  const parserStatus = stageStatus(activeStepIndex, 1)
  const unitStatus = stageStatus(activeStepIndex, 2)
  const vectorStatus = stageStatus(activeStepIndex, 3)
  const storageStatus = stageStatus(activeStepIndex, 4)

  return (
    <div className="flow-lab-stage flow-lab-stage--ingestion" aria-label="多模态数据解析动画">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_2.5rem_minmax(0,1.15fr)_2.5rem_minmax(0,0.92fr)] lg:items-stretch">
        <StagePanel eyebrow="01 · source deck" title="原始素材" status={stageStatus(activeStepIndex, 0)} tone="coral">
          <div className="grid grid-cols-2 gap-2">
            {sourceModes.map((source, index) => {
              const Icon = source.icon
              const energized = activeStepIndex === 0 || activeStepIndex > index / 2
              return (
                <div key={source.label} className={cn('flow-lab-source-card', energized && 'is-energized')}>
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg border bg-white/65 dark:bg-white/[0.06]', toneStyles[source.tone].badge, toneStyles[source.tone].icon)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="mt-3 block text-[11px] font-semibold text-[#244957] dark:text-[#dfece8]">{source.label}</span>
                  <span className="mt-0.5 block font-mono text-[9px] text-[#72888a] dark:text-[#88a2a3]">{source.detail}</span>
                </div>
              )
            })}
          </div>
          <p className="mt-3 font-mono text-[9px] tracking-[0.06em] text-[#768c8e] dark:text-[#8ca4a5]">source manifest → original object</p>
        </StagePanel>

        <FlowConnector tone="coral" status={connectorStatus(activeStepIndex, 0)} />

        <div className="grid gap-3">
          <StagePanel eyebrow="02 · modal parser" title="解析舱" status={parserStatus} tone="cyan" compact>
            <div className="flex items-center gap-3">
              <span className={cn('flow-lab-pulse-orb', parserStatus === 'active' && 'is-active', toneStyles.cyan.dot)} aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#244957] dark:text-[#e5f0ed]">各模态在自己的轨道上解析</p>
                <p className="mt-1 text-[11px] leading-5 text-[#657d80] dark:text-[#9eb4b5]">目录 · VLM · ASR · Scene / Shot</p>
              </div>
            </div>
          </StagePanel>
          <FlowConnector tone="green" status={connectorStatus(activeStepIndex, 1)} inside />
          <StagePanel eyebrow="03 · semantic manifest" title="可定位语义单元" status={unitStatus} tone="green" compact>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-medium text-[#516f72] dark:text-[#b2c5c5]">
              {['段落 Chunk', '图像 Caption', '音频片段', 'Video Shot'].map((unit) => (
                <span key={unit} className={cn('rounded-lg border px-2 py-1.5', unitStatus === 'upcoming' ? 'border-[#d5e0db] bg-white/30 dark:border-[#2c4c57] dark:bg-white/[0.02]' : 'border-[#b5d0bd] bg-white/60 dark:border-[#3d614a] dark:bg-[#5f8e72]/10')}>
                  {unit}
                </span>
              ))}
            </div>
          </StagePanel>
        </div>

        <FlowConnector tone="violet" status={connectorStatus(activeStepIndex, 2)} />

        <div className="grid gap-3">
          <StagePanel eyebrow="04 · encode lanes" title="并行索引" status={vectorStatus} tone="violet" compact>
            <div className="grid grid-cols-2 gap-1.5">
              {['Dense', 'Sparse', 'CLIP', 'CLAP', 'Shot'].map((lane, index) => (
                <span key={lane} className={cn('flow-lab-vector-lane', vectorStatus === 'active' && `is-active flow-lab-vector-lane-${index % 4}`)}>{lane}</span>
              ))}
            </div>
          </StagePanel>
          <FlowConnector tone="green" status={connectorStatus(activeStepIndex, 3)} inside />
          <StagePanel eyebrow="05 · persist" title="检索就绪" status={storageStatus} tone="green" compact>
            <div className="grid grid-cols-2 gap-2">
              <StorageChip label="MinIO" detail="objects" status={storageStatus} />
              <StorageChip label="Qdrant" detail="vectors" status={storageStatus} />
            </div>
          </StagePanel>
        </div>
      </div>
      <StageCaption tone={activeStep.tone} title={activeStep.signal} detail={activeStep.detail} />
    </div>
  )
}

function RetrievalStage({ activeStepIndex, activeStep }: { activeStepIndex: number; activeStep: FlowStep }) {
  const routingStatus = stageStatus(activeStepIndex, 1)
  const recallStatus = stageStatus(activeStepIndex, 2)
  const rankStatus = stageStatus(activeStepIndex, 3)
  const contractStatus = stageStatus(activeStepIndex, 4)
  const answerStatus = stageStatus(activeStepIndex, 5)
  const recallLanes = ['Dense', 'Sparse', 'Visual', 'Audio', 'Video']

  return (
    <div className="flow-lab-stage flow-lab-stage--retrieval" aria-label="多模态检索全链路动画">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.82fr)_2.5rem_minmax(0,1.2fr)_2.5rem_minmax(0,0.9fr)] lg:items-stretch">
        <div className="grid gap-3">
          <StagePanel eyebrow="01 · query envelope" title="问题与范围" status={stageStatus(activeStepIndex, 0)} tone="coral" compact>
            <div className="rounded-xl border border-[#e5b49c] bg-white/60 p-3 dark:border-[#754a37] dark:bg-white/[0.03]">
              <div className="flex items-center gap-2 text-[#c8643c] dark:text-[#f0ad8d]">
                <Search className="h-3.5 w-3.5" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]">question</span>
              </div>
              <p className="mt-2 text-xs font-semibold text-[#264a58] dark:text-[#e4efeb]">“找出音乐中的暗黑摇滚线索”</p>
              <p className="mt-2 text-[10px] text-[#6b8284] dark:text-[#a2b8b9]">KB · 文件范围 · 会话历史</p>
            </div>
          </StagePanel>
          <FlowConnector tone="cyan" status={connectorStatus(activeStepIndex, 0)} inside />
          <StagePanel eyebrow="02 · understand" title="检索计划" status={routingStatus} tone="cyan" compact>
            <div className="flex flex-wrap gap-1.5">
              {['query rewrite', 'modal intent', 'KB portrait'].map((item) => (
                <span key={item} className={cn('rounded-full border px-2 py-1 font-mono text-[9px]', routingStatus === 'upcoming' ? 'border-[#d3e0db] text-[#829797] dark:border-[#2c4d58] dark:text-[#7d9799]' : 'border-[#9ec8cf] bg-white/65 text-[#367484] dark:border-[#35606a] dark:bg-[#2f7f93]/10 dark:text-[#9ad8e0]')}>
                  {item}
                </span>
              ))}
            </div>
          </StagePanel>
        </div>

        <FlowConnector tone="violet" status={connectorStatus(activeStepIndex, 1)} />

        <div className="grid gap-3">
          <StagePanel eyebrow="03 · concurrent recall" title="五路并发取证" status={recallStatus} tone="violet" compact>
            <div className="space-y-1.5">
              {recallLanes.map((lane, index) => (
                <div key={lane} className={cn('flow-lab-recall-lane', recallStatus === 'active' && `is-active flow-lab-recall-lane-${index % 5}`)}>
                  <span className="font-mono text-[9px] font-semibold">{lane}</span>
                  <span className="flow-lab-recall-track"><i /></span>
                  <span className="font-mono text-[9px] text-[#73898b] dark:text-[#91aaab]">候选</span>
                </div>
              ))}
            </div>
          </StagePanel>
          <FlowConnector tone="green" status={connectorStatus(activeStepIndex, 2)} inside />
          <StagePanel eyebrow="04 · fuse + rerank" title="合并成一条证据队列" status={rankStatus} tone="green" compact>
            <div className="flex items-center gap-2">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white/55 dark:bg-white/[0.05]', toneStyles.green.badge)}><Sparkles className="h-3.5 w-3.5" /></span>
              <p className="text-[11px] leading-5 text-[#5a7477] dark:text-[#a9c0c0]">Weighted RRF 合并通道，Cross-Encoder 依问题重新排序。</p>
            </div>
          </StagePanel>
        </div>

        <FlowConnector tone="cyan" status={connectorStatus(activeStepIndex, 3)} />

        <div className="grid gap-3">
          <StagePanel eyebrow="05 · contract" title="RetrievalResult" status={contractStatus} tone="cyan" compact>
            <div className="space-y-1.5">
              {['来源与编号', '页码 / 时间范围', '媒体 URL'].map((item, index) => (
                <span key={item} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[10px]', contractStatus === 'upcoming' ? 'border-[#d5e0db] bg-white/30 text-[#829596] dark:border-[#2c4d58] dark:bg-white/[0.02]' : 'border-[#a5cbd0] bg-white/65 text-[#426e75] dark:border-[#355f69] dark:bg-[#2f7f93]/10 dark:text-[#aad9de]')}>
                  <i className={cn('h-1.5 w-1.5 rounded-full', index === 0 ? 'bg-[#2f7f93]' : index === 1 ? 'bg-[#765c95]' : 'bg-[#e47b4e]')} />
                  {item}
                </span>
              ))}
            </div>
          </StagePanel>
          <FlowConnector tone="coral" status={connectorStatus(activeStepIndex, 4)} inside />
          <StagePanel eyebrow="06 · delivery" title="带引用回答" status={answerStatus} tone="coral" compact>
            <div className={cn('rounded-xl border bg-white/65 p-2.5 dark:bg-white/[0.04]', answerStatus === 'active' ? 'border-[#e6ad91]' : 'border-[#d7e0dc] dark:border-[#2d4e58]')}>
              <p className="text-[10px] leading-5 text-[#4f6b70] dark:text-[#bfd0d0]">暗黑摇滚线索集中在… <span className="font-semibold text-[#c8643c] dark:text-[#f0ad8d]">[1] [2]</span></p>
              <span className={cn('mt-2 block h-1.5 rounded-full bg-[#d7e2dd] dark:bg-[#2a4c57]', answerStatus === 'active' && 'flow-lab-answer-line')} />
            </div>
          </StagePanel>
        </div>
      </div>
      <StageCaption tone={activeStep.tone} title={activeStep.signal} detail={activeStep.detail} />
    </div>
  )
}

function StagePanel({ eyebrow, title, status, tone, compact = false, children }: { eyebrow: string; title: string; status: StepStatus; tone: FlowTone; compact?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn(
      'relative overflow-hidden rounded-[20px] border p-3 transition-all duration-500 sm:p-4',
      status === 'active'
        ? cn('shadow-[0_14px_28px_-24px_rgba(16,45,66,0.85)]', toneStyles[tone].node, 'flow-lab-panel-active')
        : status === 'complete'
          ? 'border-[#b9cec6] bg-[#f6faf6]/80 dark:border-[#34545c] dark:bg-white/[0.035]'
          : 'border-[#d1ded8] bg-white/36 opacity-62 dark:border-[#294954] dark:bg-white/[0.018]'
    )}>
      {status === 'active' ? <span className={cn('flow-lab-panel-beacon', toneStyles[tone].dot)} aria-hidden /> : null}
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#74898b] dark:text-[#8da6a8]">{eyebrow}</p>
          <h4 className={cn('mt-1 text-[13px] font-semibold', status === 'upcoming' ? 'text-[#72878a] dark:text-[#8ca4a6]' : 'text-[#1e4554] dark:text-[#e4efeb]')}>{title}</h4>
        </div>
        {status === 'complete' ? <Check className="h-4 w-4 shrink-0 text-[#5f8e72] dark:text-[#9bcaab]" /> : null}
      </div>
      <div className={cn('relative mt-3', compact && 'mt-2.5')}>{children}</div>
    </section>
  )
}

function FlowConnector({ tone, status, inside = false }: { tone: FlowTone; status: StepStatus; inside?: boolean }) {
  return (
    <div className={cn('flow-lab-connector', inside && 'flow-lab-connector-inside', `flow-lab-connector-${status}`, `flow-lab-connector-${tone}`)} aria-hidden>
      <span className="flow-lab-connector-line" />
      <span className="flow-lab-connector-packet" />
      <ArrowRight className="flow-lab-connector-arrow h-3.5 w-3.5" />
    </div>
  )
}

function StorageChip({ label, detail, status }: { label: string; detail: string; status: StepStatus }) {
  return (
    <div className={cn('rounded-xl border p-2.5', status === 'upcoming' ? 'border-[#d8e2dd] bg-white/30 dark:border-[#2c4d58] dark:bg-white/[0.02]' : 'border-[#aac9b4] bg-white/65 dark:border-[#3c624a] dark:bg-[#5f8e72]/10')}>
      <p className="text-[11px] font-semibold text-[#244b57] dark:text-[#e0ece8]">{label}</p>
      <p className="mt-0.5 font-mono text-[9px] text-[#73898a] dark:text-[#94adae]">{detail}</p>
    </div>
  )
}

function StageCaption({ tone, title, detail }: { tone: FlowTone; title: string; detail: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#c9d8d2] pt-3 dark:border-[#294b56]">
      <span className={cn('inline-flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em]', toneStyles[tone].icon)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', toneStyles[tone].dot)} />
        active signal
      </span>
      <span className="font-mono text-[10px] text-[#587479] dark:text-[#abc0c1]">{title}</span>
      <span className="hidden h-1 w-1 rounded-full bg-[#a9bcb7] sm:inline" />
      <span className="text-[10px] text-[#788e90] dark:text-[#8fa7a8]">{detail}</span>
    </div>
  )
}

function stageStatus(activeStepIndex: number, stageIndex: number): StepStatus {
  if (stageIndex < activeStepIndex) return 'complete'
  if (stageIndex === activeStepIndex) return 'active'
  return 'upcoming'
}

function connectorStatus(activeStepIndex: number, connectorIndex: number): StepStatus {
  if (activeStepIndex > connectorIndex) return activeStepIndex === connectorIndex + 1 ? 'active' : 'complete'
  return 'upcoming'
}
