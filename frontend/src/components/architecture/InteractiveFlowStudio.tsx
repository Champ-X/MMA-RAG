import { useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
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
import './InteractiveFlowStudio.css'

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
  const studioRef = useRef<HTMLElement>(null)
  const journey = journeys[journeyId]
  const activeStep = journey.steps[activeStepIndex]
  const isLastStep = activeStepIndex === journey.steps.length - 1

  useEffect(() => {
    if (!autoPlaying || isLastStep) return
    const timer = window.setTimeout(() => setActiveStepIndex((current) => current + 1), 3200)
    return () => window.clearTimeout(timer)
  }, [autoPlaying, activeStepIndex, isLastStep])

  useEffect(() => {
    if (autoPlaying && isLastStep) setAutoPlaying(false)
  }, [autoPlaying, isLastStep])

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setAutoPlaying(false)
    }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setAutoPlaying(false)
    })
    if (studioRef.current) observer.observe(studioRef.current)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
      observer.disconnect()
    }
  }, [])

  const selectJourney = (nextJourney: string) => {
    setJourneyId(nextJourney as JourneyId)
    setActiveStepIndex(0)
    setAutoPlaying(false)
  }

  const togglePlayback = () => {
    if (!autoPlaying && isLastStep) setActiveStepIndex(0)
    setAutoPlaying((playing) => !playing)
  }

  const statusFor = (stepIndex: number): StepStatus => {
    if (stepIndex < activeStepIndex) return 'complete'
    if (stepIndex === activeStepIndex) return 'active'
    return 'upcoming'
  }

  return (
    <section ref={studioRef} id="flow-lab" className="flow-studio scroll-mt-24" data-playing={autoPlaying}>
      <div className="flow-studio-section-heading">
        <div>
          <p className="flow-studio-eyebrow">INTERACTIVE EXPLORER</p>
          <h2 className="architecture-display">沿着证据，走一遍系统。</h2>
        </div>
        <p className="flow-studio-section-intro">
          从原始素材到可引用的回答，逐步观察每个环节接收什么、产出什么。
          点击节点探索，或播放完整链路。
        </p>
      </div>

      <Tabs.Root value={journeyId} onValueChange={selectJourney} className="flow-studio-shell">
        <div className="flow-studio-toolbar">
          <Tabs.List aria-label="选择架构演示链路" className="flow-studio-tabs">
            {(Object.keys(journeys) as JourneyId[]).map((id) => (
              <Tabs.Trigger key={id} value={id} className="flow-studio-tab">
                {id === 'ingestion' ? <Boxes aria-hidden="true" /> : <Search aria-hidden="true" />}
                <span>{id === 'ingestion' ? '数据解析' : '检索链路'}</span>
                <span className="flow-studio-tab-code" aria-hidden="true">{id === 'ingestion' ? 'WRITE' : 'READ'}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <span className="flow-studio-demo-label"><span aria-hidden="true" />交互示意 · 非实时任务</span>
        </div>

        <Tabs.Content value={journeyId} className="flow-studio-content">
          <div className="flow-studio-journey-heading">
            <div>
              <p className="flow-studio-eyebrow">{journey.eyebrow}</p>
              <h3 className="architecture-display">{journey.title}</h3>
              <p className="flow-studio-journey-description">{journey.description}</p>
            </div>
            <div className="flow-studio-controls" role="group" aria-label="演示播放控制">
              <button
                type="button"
                onClick={() => {
                  setActiveStepIndex((index) => Math.max(0, index - 1))
                  setAutoPlaying(false)
                }}
                disabled={activeStepIndex === 0}
                className="flow-studio-control"
                aria-label="上一步"
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                className="flow-studio-play"
                aria-label={autoPlaying ? '暂停演示' : isLastStep ? '重新播放演示' : '播放演示'}
              >
                {autoPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                <span>{autoPlaying ? '暂停' : isLastStep ? '重播' : '播放'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveStepIndex((index) => Math.min(journey.steps.length - 1, index + 1))
                  setAutoPlaying(false)
                }}
                disabled={isLastStep}
                className="flow-studio-control"
                aria-label="下一步"
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>

          <ol className="flow-studio-timeline" role="list" data-steps={journey.steps.length} aria-label={`${journey.label}步骤`}>
            {journey.steps.map((step, index) => (
              <li key={step.id}>
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

          <div className="flow-studio-stage-container">
            {journeyId === 'ingestion' ? (
              <IngestionStage activeStepIndex={activeStepIndex} activeStep={activeStep} />
            ) : (
              <RetrievalStage activeStepIndex={activeStepIndex} activeStep={activeStep} />
            )}
          </div>

          <div className="flow-studio-detail">
            <div className="flow-studio-detail-copy">
              <span className="flow-studio-detail-marker" aria-hidden="true">{activeStep.marker}</span>
              <div>
                <p className="flow-studio-detail-title">{activeStep.title}</p>
                <p>{activeStep.description}</p>
              </div>
            </div>
            <FlowNarrator step={activeStep} stepIndex={activeStepIndex} total={journey.steps.length} />
          </div>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {journey.label}，第 {activeStepIndex + 1} 步，共 {journey.steps.length} 步：{activeStep.title}
          </p>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  )
}

function TimelineStep({ step, status, onSelect }: { step: FlowStep; status: StepStatus; onSelect: () => void }) {
  const active = status === 'active'
  const complete = status === 'complete'

  return (
    <button
      type="button"
      aria-current={active ? 'step' : undefined}
      onClick={onSelect}
      className="flow-studio-step"
      data-status={status}
    >
      <span className="flow-studio-step-marker" aria-hidden="true">
        {complete ? <Check /> : step.marker}
      </span>
      <span className="flow-studio-step-copy">
        <span className="flow-studio-step-title">{step.title}</span>
        <span className="flow-studio-step-short">{step.short}</span>
      </span>
    </button>
  )
}

function FlowNarrator({ step, stepIndex, total }: { step: FlowStep; stepIndex: number; total: number }) {
  return (
    <div className="flow-studio-narrator">
      <p className="flow-studio-eyebrow">STEP {String(stepIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</p>
      <p className="flow-studio-narrator-signal">{step.signal}</p>
      <p>{step.detail}</p>
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
    <div className="flow-lab-stage flow-lab-stage--ingestion" role="group" aria-label="多模态数据解析示意">
      <div className="flow-studio-diagram">
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
                  <span className="mt-0.5 block font-mono text-[11px] text-[#72888a] dark:text-[#88a2a3]">{source.detail}</span>
                </div>
              )
            })}
          </div>
          <p className="mt-3 font-mono text-[11px] tracking-[0.06em] text-[#768c8e] dark:text-[#8ca4a5]">source manifest → original object</p>
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
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-medium text-[#516f72] dark:text-[#b2c5c5]">
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
    <div className="flow-lab-stage flow-lab-stage--retrieval" role="group" aria-label="多模态检索全链路示意">
      <div className="flow-studio-diagram">
        <div className="grid gap-3">
          <StagePanel eyebrow="01 · query envelope" title="问题与范围" status={stageStatus(activeStepIndex, 0)} tone="coral" compact>
            <div className="rounded-xl border border-[#e5b49c] bg-white/60 p-3 dark:border-[#754a37] dark:bg-white/[0.03]">
              <div className="flex items-center gap-2 text-[#c8643c] dark:text-[#f0ad8d]">
                <Search className="h-3.5 w-3.5" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em]">question</span>
              </div>
              <p className="mt-2 text-xs font-semibold text-[#264a58] dark:text-[#e4efeb]">“找出音乐中的暗黑摇滚线索”</p>
              <p className="mt-2 text-[11px] text-[#6b8284] dark:text-[#a2b8b9]">KB · 文件范围 · 会话历史</p>
            </div>
          </StagePanel>
          <FlowConnector tone="cyan" status={connectorStatus(activeStepIndex, 0)} inside />
          <StagePanel eyebrow="02 · understand" title="检索计划" status={routingStatus} tone="cyan" compact>
            <div className="flex flex-wrap gap-1.5">
              {['query rewrite', 'modal intent', 'KB portrait'].map((item) => (
                <span key={item} className={cn('rounded-full border px-2 py-1 font-mono text-[11px]', routingStatus === 'upcoming' ? 'border-[#d3e0db] text-[#829797] dark:border-[#2c4d58] dark:text-[#7d9799]' : 'border-[#9ec8cf] bg-white/65 text-[#367484] dark:border-[#35606a] dark:bg-[#2f7f93]/10 dark:text-[#9ad8e0]')}>
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
                  <span className="font-mono text-[11px] font-semibold">{lane}</span>
                  <span className="flow-lab-recall-track"><i /></span>
                  <span className="font-mono text-[11px] text-[#73898b] dark:text-[#91aaab]">候选</span>
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
                <span key={item} className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px]', contractStatus === 'upcoming' ? 'border-[#d5e0db] bg-white/30 text-[#829596] dark:border-[#2c4d58] dark:bg-white/[0.02]' : 'border-[#a5cbd0] bg-white/65 text-[#426e75] dark:border-[#355f69] dark:bg-[#2f7f93]/10 dark:text-[#aad9de]')}>
                  <i className={cn('h-1.5 w-1.5 rounded-full', index === 0 ? 'bg-[#2f7f93]' : index === 1 ? 'bg-[#765c95]' : 'bg-[#e47b4e]')} />
                  {item}
                </span>
              ))}
            </div>
          </StagePanel>
          <FlowConnector tone="coral" status={connectorStatus(activeStepIndex, 4)} inside />
          <StagePanel eyebrow="06 · delivery" title="带引用回答" status={answerStatus} tone="coral" compact>
            <div className={cn('rounded-xl border bg-white/65 p-2.5 dark:bg-white/[0.04]', answerStatus === 'active' ? 'border-[#e6ad91]' : 'border-[#d7e0dc] dark:border-[#2d4e58]')}>
              <p className="text-[11px] leading-5 text-[#4f6b70] dark:text-[#bfd0d0]">暗黑摇滚线索集中在… <span className="font-semibold text-[#c8643c] dark:text-[#f0ad8d]">[1] [2]</span></p>
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
      'flow-studio-stage-panel relative overflow-hidden rounded-xl border p-3 transition-colors duration-300 sm:p-4',
      status === 'active'
        ? cn('shadow-[0_14px_28px_-24px_rgba(16,45,66,0.85)]', toneStyles[tone].node, 'flow-lab-panel-active')
        : status === 'complete'
          ? 'border-[#b9cec6] bg-[#f6faf6]/80 dark:border-[#34545c] dark:bg-white/[0.035]'
          : 'border-[#d4dfe2] bg-white/75 dark:border-[#294954] dark:bg-white/[0.018]'
    )}>
      {status === 'active' ? <span className={cn('flow-lab-panel-beacon', toneStyles[tone].dot)} aria-hidden /> : null}
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[#74898b] dark:text-[#8da6a8]">{eyebrow}</p>
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
      <p className="mt-0.5 font-mono text-[11px] text-[#73898a] dark:text-[#94adae]">{detail}</p>
    </div>
  )
}

function StageCaption({ tone, title, detail }: { tone: FlowTone; title: string; detail: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#c9d8d2] pt-3 dark:border-[#294b56]">
      <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]', toneStyles[tone].icon)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', toneStyles[tone].dot)} />
        selected signal
      </span>
      <span className="font-mono text-[11px] text-[#587479] dark:text-[#abc0c1]">{title}</span>
      <span className="hidden h-1 w-1 rounded-full bg-[#a9bcb7] sm:inline" />
      <span className="text-[11px] text-[#788e90] dark:text-[#8fa7a8]">{detail}</span>
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
