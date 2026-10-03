import { useEffect, useRef, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type { LucideIcon } from 'lucide-react'
import {
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
import { ConnectorLayer, type ConnectionSpec } from './ConnectorLayer'
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
    description: '从文件进入，到对象与索引落盘；按模态保留原始素材、文字描述与专用检索表示。',
    steps: [
      {
        id: 'receive',
        marker: '01',
        title: '接入来源',
        short: '文件进入工作台',
        description: '接收上传、URL、文件夹或外部内容，记录文件名、来源与类型，再交给相应解析器处理。',
        signal: 'source metadata',
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
        description: '解析结果组织为文档块、图片描述、音频转写与视频 Shot，并保留回到原始素材的来源定位。',
        signal: 'evidence units',
        detail: 'Chunk · Caption · Audio transcript · Shot',
        tone: 'green',
        icon: ListTree,
      },
      {
        id: 'encode',
        marker: '04',
        title: '分模态建立索引',
        short: '语义与专用向量',
        description: '文档建立语义与稀疏索引，图片补充 CLIP、音频补充 CLAP，视频保存镜头描述与转写的检索表示。',
        signal: 'multimodal vectors',
        detail: 'Dense · Sparse · CLIP · CLAP · Shot',
        tone: 'violet',
        icon: Layers3,
      },
      {
        id: 'persist',
        marker: '05',
        title: '落盘并可检索',
        short: '对象层 + 索引层',
        description: '原文件、关键帧与视频解析清单保存在 MinIO；文本、元数据及向量索引进入 Qdrant。',
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
    title: '一个问题，从不同通道汇集证据',
    description: '先明确问题与范围，再按需召回、融合排序，并把实际采用的来源关联到回答。',
    steps: [
      {
        id: 'question',
        marker: '01',
        title: '接收问题与范围',
        short: '问题不会脱离上下文',
        description: '会话历史、知识库范围、指定文件与附件摘要参与本轮请求；Agent 补查继续沿用同一范围约束。',
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
        title: '五路按需召回',
        short: '每个模态各取所长',
        description: 'Dense 与 Sparse 常规启用，图片、音频与视频通道按模态需求并行召回，所有通道遵循同一范围约束。',
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
        description: '加权 RRF 根据各通道的候选排名融合结果，再默认由 Cross-Encoder 按问题与材料的匹配度精排。',
        signal: 'ranked evidence',
        detail: 'Weighted RRF · Cross-Encoder',
        tone: 'green',
        icon: Sparkles,
      },
      {
        id: 'contract',
        marker: '05',
        title: '组织材料与引用',
        short: '预算与来源映射',
        description: 'Direct 与 Agent 都输出 RetrievalResult。ContextBuilder 按预算选择材料并建立引用编号；流式发送前补全文档相邻段落，以及可用的媒体定位。',
        signal: 'reference map',
        detail: 'RetrievalResult · ReferenceMap',
        tone: 'cyan',
        icon: Boxes,
      },
      {
        id: 'answer',
        marker: '06',
        title: '生成并收束引用',
        short: '候选 → 正文 → 最终引用',
        description: '候选来源先通过 SSE 预载，正文随后流式到达。完成时按正文实际引用的编号替换来源列表；未使用引用则清空，编号筛选不代表事实核验。',
        signal: 'cited answer',
        detail: 'SSE · Citation replacement',
        tone: 'coral',
        icon: Send,
      },
    ],
  },
}

const toneStyles: Record<FlowTone, { dot: string; badge: string }> = {
  cyan: { dot: 'flow-tone-dot flow-tone-cyan', badge: 'flow-tone-badge flow-tone-cyan' },
  green: { dot: 'flow-tone-dot flow-tone-green', badge: 'flow-tone-badge flow-tone-green' },
  violet: { dot: 'flow-tone-dot flow-tone-violet', badge: 'flow-tone-badge flow-tone-violet' },
  coral: { dot: 'flow-tone-dot flow-tone-coral', badge: 'flow-tone-badge flow-tone-coral' },
}

export function InteractiveFlowStudio() {
  const [journeyId, setJourneyId] = useState<JourneyId>('ingestion')
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [autoPlaying, setAutoPlaying] = useState(false)
  const studioRef = useRef<HTMLElement>(null)
  const timelineRef = useRef<HTMLOListElement>(null)
  const journey = journeys[journeyId]
  const activeStep = journey.steps[activeStepIndex]
  const isLastStep = activeStepIndex === journey.steps.length - 1

  useEffect(() => {
    const rail = timelineRef.current
    const step = rail?.children[activeStepIndex] as HTMLElement | undefined
    if (!rail || !step || rail.scrollWidth <= rail.clientWidth) return
    const offset = step.getBoundingClientRect().left - rail.getBoundingClientRect().left
    if (offset < 0 || offset + step.offsetWidth > rail.clientWidth) {
      rail.scrollTo({ left: rail.scrollLeft + offset - (rail.clientWidth - step.offsetWidth) / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, [activeStepIndex, journeyId])

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
          <p className="flow-studio-eyebrow">交互演示 / Follow the evidence</p>
          <h2 className="architecture-display">看见每一次转换。</h2>
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

          <ol ref={timelineRef} className="flow-studio-timeline" role="list" data-steps={journey.steps.length} aria-label={`${journey.label}步骤`}>
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

          <div className="flow-studio-detail" data-tone={activeStep.tone}>
            <div className="flow-studio-detail-copy">
              <span className="flow-studio-detail-marker" aria-hidden="true">{activeStep.marker}</span>
              <div>
                <p className="sr-only">{activeStep.title}</p>
                <p>{activeStep.description}</p>
              </div>
            </div>
          </div>

          <div className="flow-studio-stage-container">
            <div className="flow-studio-canvas-heading">
              <div><span className="flow-studio-canvas-mark" aria-hidden="true"><Layers3 size={15} /></span><span>{journeyId === 'ingestion' ? '多模态解析工作台' : '多通道证据工作台'}</span><small lang="en">{journeyId === 'ingestion' ? 'INGESTION MAP' : 'RETRIEVAL MAP'}</small></div>
              <div className="flow-studio-state-legend" role="group" aria-label="节点状态图例"><span data-status="complete">前序阶段</span><span data-status="active">当前阶段</span><span data-status="upcoming">待探索</span></div>
            </div>
            {journeyId === 'ingestion' ? (
              <IngestionStage activeStepIndex={activeStepIndex} activeStep={activeStep} />
            ) : (
              <RetrievalStage activeStepIndex={activeStepIndex} activeStep={activeStep} />
            )}
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

function IngestionStage({ activeStepIndex, activeStep }: { activeStepIndex: number; activeStep: FlowStep }) {
  const sourceModes = [
    { id: 'document', label: '文档', detail: '结构', icon: FileText },
    { id: 'image', label: '图片', detail: '视觉', icon: Image },
    { id: 'audio', label: '音频', detail: '转写', icon: AudioLines },
    { id: 'video', label: '视频', detail: '镜头', icon: Video },
  ]
  const parserStatus = stageStatus(activeStepIndex, 1)
  const unitStatus = stageStatus(activeStepIndex, 2)
  const vectorStatus = stageStatus(activeStepIndex, 3)
  const storageStatus = stageStatus(activeStepIndex, 4)
  const connections: ConnectionSpec[] = [
    { id: 'source-parse', from: 'source', to: 'parse', tone: 'amber', status: connectorStatus(activeStepIndex, 0) },
    { id: 'parse-unit', fromAnchor: 'bottom', toAnchor: 'top', from: 'parse', to: 'unit', tone: 'teal', status: connectorStatus(activeStepIndex, 1) },
    { id: 'unit-vector', from: 'unit', to: 'vector', tone: 'accent', status: connectorStatus(activeStepIndex, 2) },
    { id: 'vector-storage', fromAnchor: 'bottom', toAnchor: 'top', from: 'vector', to: 'storage', tone: 'teal', status: connectorStatus(activeStepIndex, 3) },
  ]

  return (
    <div className="flow-lab-stage flow-lab-stage--ingestion" role="group" aria-label="多模态数据解析示意">
      <div className="flow-studio-diagram">
        <ConnectorLayer connections={connections} />
        <StagePanel nodeId="source" eyebrow="01 · source deck" title="原始素材" status={stageStatus(activeStepIndex, 0)} tone="coral">
          <div className="flow-studio-source-grid">
            {sourceModes.map((source, index) => {
              const Icon = source.icon
              const energized = activeStepIndex === 0 || activeStepIndex > index / 2
              return (
                <div key={source.id} data-source={source.id} className={cn('flow-lab-source-card', energized && 'is-energized')}>
                  <span className="flow-studio-source-icon"><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></span>
                  <strong>{source.label}</strong>
                  <span className="flow-studio-source-detail">{source.detail}</span>
                </div>
              )
            })}
          </div>
          <p className="flow-studio-source-note">source metadata → modal parser</p>
        </StagePanel>

        <div className="flow-studio-stage-column">
          <StagePanel nodeId="parse" eyebrow="02 · modal parser" title="解析舱" status={parserStatus} tone="cyan">
            <div className="flow-studio-parser-summary">
              <span className={cn('flow-lab-pulse-orb', parserStatus === 'active' && 'is-active', toneStyles.cyan.dot)} aria-hidden="true" />
              <div>
                <p className="flow-studio-panel-emphasis">各模态在自己的轨道上解析</p>
                <p className="flow-studio-panel-note">目录 · VLM · ASR · Scene / Shot</p>
              </div>
            </div>
          </StagePanel>
          <StagePanel nodeId="unit" eyebrow="03 · semantic manifest" title="可定位语义单元" status={unitStatus} tone="green">
            <div className="flow-studio-unit-grid">
              {['段落 Chunk', '图像 Caption', '音频转写', 'Video Shot'].map((unit) => <span key={unit}>{unit}</span>)}
            </div>
          </StagePanel>
        </div>

        <div className="flow-studio-stage-column">
          <StagePanel nodeId="vector" eyebrow="04 · encode lanes" title="多路索引" status={vectorStatus} tone="violet">
            <div className="flow-studio-unit-grid flow-studio-vector-grid">
              {['Dense', 'Sparse', 'CLIP', 'CLAP', 'Shot'].map((lane, index) => (
                <span key={lane} className={cn('flow-lab-vector-lane', vectorStatus === 'active' && `is-active flow-lab-vector-lane-${index % 4}`)}>{lane}</span>
              ))}
            </div>
          </StagePanel>
          <StagePanel nodeId="storage" eyebrow="05 · persist" title="检索就绪" status={storageStatus} tone="green">
            <div className="flow-studio-storage-grid">
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
  const connections: ConnectionSpec[] = [
    { id: 'question-understand', fromAnchor: 'bottom', toAnchor: 'top', from: 'question', to: 'understand', tone: 'blue', status: connectorStatus(activeStepIndex, 0) },
    { id: 'understand-recall', from: 'understand', to: 'recall', tone: 'accent', status: connectorStatus(activeStepIndex, 1) },
    { id: 'recall-rank', fromAnchor: 'bottom', toAnchor: 'top', from: 'recall', to: 'rank', tone: 'teal', status: connectorStatus(activeStepIndex, 2) },
    { id: 'rank-contract', from: 'rank', to: 'contract', tone: 'blue', status: connectorStatus(activeStepIndex, 3) },
    { id: 'contract-answer', fromAnchor: 'bottom', toAnchor: 'top', from: 'contract', to: 'answer', tone: 'amber', status: connectorStatus(activeStepIndex, 4) },
  ]

  return (
    <div className="flow-lab-stage flow-lab-stage--retrieval" role="group" aria-label="多模态检索全链路示意">
      <div className="flow-studio-diagram">
        <ConnectorLayer connections={connections} />
        <div className="flow-studio-stage-column">
          <StagePanel nodeId="question" eyebrow="01 · query envelope" title="问题与范围" status={stageStatus(activeStepIndex, 0)} tone="coral">
            <div className="flow-studio-query-card">
              <div className="flow-studio-query-label"><Search size={17} aria-hidden="true" /><span>Question</span></div>
              <p className="flow-studio-question">“找出音乐中的暗黑摇滚线索”</p>
              <p className="flow-studio-panel-note">KB · 文件范围 · 会话历史</p>
            </div>
          </StagePanel>
          <StagePanel nodeId="understand" eyebrow="02 · understand" title="检索计划" status={routingStatus} tone="cyan">
            <div className="flow-studio-plan-tags">
              {['query rewrite', 'modal intent', 'KB portrait'].map((item) => <span key={item}>{item}</span>)}
            </div>
          </StagePanel>
        </div>

        <div className="flow-studio-stage-column">
          <StagePanel nodeId="recall" eyebrow="03 · concurrent recall" title="五路按需取证" status={recallStatus} tone="violet">
            <div className="flow-studio-recall-list">
              {recallLanes.map((lane, index) => (
                <div key={lane} className={cn('flow-lab-recall-lane', recallStatus === 'active' && `is-active flow-lab-recall-lane-${index % 5}`)}>
                  <span className="flow-studio-recall-name">{lane}</span>
                  <span className="flow-lab-recall-track"><i /></span>
                  <span className="flow-studio-recall-count">候选</span>
                </div>
              ))}
            </div>
          </StagePanel>
          <StagePanel nodeId="rank" eyebrow="04 · fuse + rerank" title="合并成一条证据队列" status={rankStatus} tone="green">
            <div className="flow-studio-rank-summary">
              <span className={cn('flow-studio-rank-icon', toneStyles.green.badge)}><Sparkles size={19} aria-hidden="true" /></span>
              <p>RRF 按候选排名融合，默认由 Cross-Encoder 依问题精排。</p>
            </div>
          </StagePanel>
        </div>

        <div className="flow-studio-stage-column">
          <StagePanel nodeId="contract" eyebrow="05 · contract" title="ReferenceMap" status={contractStatus} tone="cyan">
            <div className="flow-studio-reference-list">
              {['文件与内容编号', '文档相邻段落', '媒体与可用时间范围'].map((item, index) => <span key={item}><i data-reference-tone={index} aria-hidden="true" />{item}</span>)}
            </div>
          </StagePanel>
          <StagePanel nodeId="answer" eyebrow="06 · delivery" title="带引用回答" status={answerStatus} tone="coral">
            <div className="flow-studio-answer-card">
              <p>暗黑摇滚线索集中在… <span>[1] [2]</span></p>
              <span className={cn('flow-studio-answer-track', answerStatus === 'active' && 'flow-lab-answer-line')} />
            </div>
          </StagePanel>
        </div>
      </div>
      <StageCaption tone={activeStep.tone} title={activeStep.signal} detail={activeStep.detail} />
    </div>
  )
}

function StagePanel({ nodeId, eyebrow, title, status, tone, children }: { nodeId: string; eyebrow: string; title: string; status: StepStatus; tone: FlowTone; children: React.ReactNode }) {
  return (
    <section className={cn('flow-studio-stage-panel', status === 'active' && 'flow-lab-panel-active')} data-connection-node={nodeId} data-status={status} data-tone={tone}>
      <div className="flow-studio-panel-heading">
        <div><p className="flow-studio-panel-eyebrow">{eyebrow}</p><h4>{title}</h4></div>
        <span className="flow-studio-panel-state" role="img" aria-label={status === 'complete' ? '前序阶段' : status === 'active' ? '当前阶段' : '待探索'}>{status === 'complete' ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true" />}</span>
      </div>
      <div className="flow-studio-panel-body">{children}</div>
    </section>
  )
}

function StorageChip({ label, detail, status }: { label: string; detail: string; status: StepStatus }) {
  return <div className="flow-studio-storage-chip" data-status={status}><strong>{label}</strong><span>{detail}</span></div>
}

function StageCaption({ tone, title, detail }: { tone: FlowTone; title: string; detail: string }) {
  return <div className="flow-studio-stage-caption" data-tone={tone}><span className="flow-studio-caption-label"><span className={toneStyles[tone].dot} aria-hidden="true" />当前输出</span><span className="flow-studio-caption-title">{title}</span><span className="flow-studio-caption-detail">{detail}</span></div>
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
