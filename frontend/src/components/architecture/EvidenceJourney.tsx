import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pause,
  Play,
  Video,
} from 'lucide-react'
import type { ArchitectureMode } from '@/data/architectureExperience'
import './evidenceJourney.css'

type Journey = 'ingestion' | 'query'
type EvidenceView = 'files' | 'parsed' | 'located' | 'indexed' | 'scope' | 'retrieved' | 'context' | 'observed' | 'answer'

interface JourneyStep {
  id: string
  label: string
  title: string
  description: string
  action: string
  view: EvidenceView
}

const ingestionSteps: JourneyStep[] = [
  {
    id: 'files', label: '接收素材', title: '先保留原件，再理解内容',
    description: '视频与讲义各自保留来源身份。原文件进入对象存储，后续派生内容始终可以回到这份原件。',
    action: '原视频 + 原文档 → MinIO', view: 'files',
  },
  {
    id: 'parse', label: '按模态解析', title: '把内容变成可以阅读的表示',
    description: '视频形成镜头、关键帧、描述和语音转写；文档形成保留原文的文本块。转写与模型描述分别标记。',
    action: '视频 Shot / ASR · 文档 Chunk', view: 'parsed',
  },
  {
    id: 'locate', label: '绑定来源', title: '文字片段有位置，也有来处',
    description: '派生片段携带来源和位置：视频使用时间区间，文档使用页码等定位。下方 E-01 / E-02 是这个示例里的固定证据身份。',
    action: '来源身份 + 时间 / 页码', view: 'located',
  },
  {
    id: 'index', label: '建立索引', title: '原件与检索表示各司其职',
    description: '文本与镜头描述建立语义和词面索引，关键帧补充视觉表示。Qdrant 用于检索，MinIO 保留原件和派生物。',
    action: 'MinIO 原件 ↔ Qdrant 索引', view: 'indexed',
  },
]

const querySteps: Record<ArchitectureMode, JourneyStep[]> = {
  direct: [
    {
      id: 'scope', label: '明确问题', title: '确定要回答什么、在哪里查找',
      description: '把问题与所选知识库、文件范围交给常规问答链路，按意图组织检索查询和模态需求。',
      action: '问题 + 来源范围', view: 'scope',
    },
    {
      id: 'retrieve', label: '检索证据', title: '一次完整检索，汇集相关片段',
      description: '公共检索服务按需召回视频镜头转写、描述与讲义原文，融合并重排。这里展示的是索引内容。',
      action: 'RetrievalService · 融合 / 重排', view: 'retrieved',
    },
    {
      id: 'context', label: '组织上下文', title: '把来源与片段一起交给生成器',
      description: '上下文构建器整理证据并分配稳定引用编号。Direct 用检索到的表示组织回答，不在这一流程里直接观察原视频。',
      action: '上下文 + 引用编号 → 公共生成链', view: 'context',
    },
    {
      id: 'answer', label: '回答与引用', title: '回答落在具体的来源上',
      description: '生成回答只保留实际采用的来源。点击引用，可返回它对应的转写区间或讲义原文。',
      action: '正文 + 实际采用的引用', view: 'answer',
    },
  ],
  agent: [
    {
      id: 'scope', label: '原问题取证', title: '先检索原问题，建立证据起点',
      description: '常规 Agent 先沿所选来源范围检索原问题，获得第一组视频与讲义线索，再判断还需要补充什么。',
      action: '原问题 → 常规检索服务', view: 'scope',
    },
    {
      id: 'search', label: '规划补查', title: '从已有证据中，识别需要补齐的部分',
      description: '已有视频转写可以提供概念线索。如果讲义依据不足，Agent 规划互补子问题，继续调用常规检索服务。',
      action: '已有证据 → 缺口与补查计划', view: 'parsed',
    },
    {
      id: 'retrieve', label: '补查与合并', title: '在预算内补齐讲义依据',
      description: '追加查询定位讲义中的定义。补查受轮数与查询预算约束；跨轮去重，最终合并时限制交付的证据量。',
      action: '追加检索 → 去重合并', view: 'retrieved',
    },
    {
      id: 'context', label: '组织上下文', title: '多轮取证，汇合到公共生成链',
      description: '合并后的证据交给公共上下文构建器与生成器。常规 Agent 的补查仍使用索引证据。',
      action: '证据集 → 公共生成链', view: 'context',
    },
    {
      id: 'answer', label: '回答与引用', title: '合并解释，也保留每份依据',
      description: '视频转写与讲义原文共同支撑回答。点击引用，回到相应来源片段。',
      action: '正文 + 实际采用的引用', view: 'answer',
    },
  ],
  pi: [
    {
      id: 'scope', label: '明确交付', title: '把问题变成研究目标',
      description: 'Pi 的独立运行时组织研究，宿主限定可以访问的来源。这里演示一种可能的工具顺序，实际选择由任务决定。',
      action: '独立 Pi 循环 · 宿主校验范围', view: 'scope',
    },
    {
      id: 'search', label: '搜索片段', title: '用独立搜索先找到位置',
      description: 'search 对允许的来源进行精确短语或语义与词面融合搜索，找到视频区间与讲义片段。',
      action: 'search', view: 'located',
    },
    {
      id: 'read', label: '深读原文', title: '读取片段，保留原编号与位置',
      description: 'read_source 分页读取解析原文或媒体索引记录，保留真实位置。长片段可以续读。',
      action: 'read_source', view: 'retrieved',
    },
    {
      id: 'inspect', label: '查看媒体', title: '回到原视频，补充画面观察',
      description: 'inspect_media 查看指定媒体区间，记录绝对时间并把模型观察与转写分开。视频采样不等于逐帧核验。',
      action: 'inspect_media', view: 'observed',
    },
    {
      id: 'answer', label: '提交回答', title: '提交已取得证据支持的回答',
      description: 'submit_answer 接收 Pi 的最终正文；宿主检查引用身份与编号一致性。编号校验仍需要配合语义核对。',
      action: 'submit_answer', view: 'answer',
    },
  ],
}

const modeNames: Record<ArchitectureMode, string> = { direct: 'Direct', agent: '有界 Agent', pi: 'Pi Agent' }

function EvidenceExcerpt({ kind, children }: { kind: 'transcript' | 'original' | 'observation'; children: React.ReactNode }) {
  const labels = { transcript: '语音转写', original: '讲义原文', observation: '模型观察' }
  return (
    <div className={`journey-excerpt journey-excerpt--${kind}`}>
      <span className="journey-type">{labels[kind]}</span>
      <p>{children}</p>
    </div>
  )
}

function VideoFrame({ showDiagram = false }: { showDiagram?: boolean }) {
  return (
    <div className="journey-video-frame" aria-label="示例视频片段，贝叶斯更新示意画面">
      <div className="journey-frame-top"><Video size={15} aria-hidden="true" /><span>概念课 · 贝叶斯更新</span><span>示意画面</span></div>
      <div className="journey-frame-diagram" aria-hidden="true">
        <span>先验</span><span className="journey-frame-symbol">×</span><span>新证据</span><ArrowRight size={20} /><span className="journey-frame-posterior">后验</span>
      </div>
      {showDiagram && <p className="journey-frame-note">归一化后，更新对事件的判断</p>}
      <div className="journey-video-timeline" aria-hidden="true"><span /></div>
      <div className="journey-frame-time"><span>02:18—02:42</span><span>来源 VIDEO-01</span></div>
    </div>
  )
}

export function EvidenceJourney({ mode }: { mode: ArchitectureMode }) {
  const [journey, setJourney] = useState<Journey>('query')
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [focusedEvidence, setFocusedEvidence] = useState<'E-01' | 'E-02' | 'E-03' | null>(null)
  const evidenceTitle = useRef<HTMLHeadingElement>(null)
  const videoEvidence = useRef<HTMLElement>(null)
  const lectureEvidence = useRef<HTMLElement>(null)
  const mediaEvidence = useRef<HTMLElement>(null)
  const steps = journey === 'ingestion' ? ingestionSteps : querySteps[mode]
  const activeIndex = Math.min(stepIndex, steps.length - 1)
  const step = steps[activeIndex]

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setReducedMotion(preference.matches)
      if (preference.matches) setPlaying(false)
    }
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setStepIndex(0)
    setPlaying(false)
    setFocusedEvidence(null)
  }, [mode, journey])

  useEffect(() => {
    if (!playing || reducedMotion) return
    if (activeIndex === steps.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setStepIndex(index => index + 1), 5000)
    return () => window.clearTimeout(timer)
  }, [playing, reducedMotion, activeIndex, steps.length])

  const goToStep = (index: number) => {
    setPlaying(false)
    setStepIndex(index)
    setFocusedEvidence(null)
  }

  const openCitation = (identity: 'E-01' | 'E-02' | 'E-03') => {
    const sourceStep = identity === 'E-03' ? 'inspect' : mode === 'pi' ? 'read' : 'retrieve'
    const sourceIndex = steps.findIndex(item => item.id === sourceStep)
    goToStep(Math.max(0, sourceIndex))
    window.requestAnimationFrame(() => {
      const target = identity === 'E-01' ? videoEvidence.current : identity === 'E-02' ? lectureEvidence.current : mediaEvidence.current
      const focusTarget = target ?? evidenceTitle.current
      focusTarget?.focus({ preventScroll: true })
      focusTarget?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    })
    setFocusedEvidence(identity)
  }

  const isAnswer = step.view === 'answer'
  const showLecture = !['files', 'parsed', 'scope'].includes(step.view)
  const showObservation = step.view === 'observed' || (isAnswer && mode === 'pi')

  return (
    <div className="evidence-journey">
      <div className="atlas-section-intro journey-intro">
        <div><h2>跟随一份证据</h2></div>
        <p>以一段视频和一份讲义为例。从素材入库走到回答，再点击引用回到证据。</p>
      </div>

      <div className="journey-toolbar">
        <div className="journey-switch" role="group" aria-label="选择演示链路">
          <button type="button" aria-pressed={journey === 'ingestion'} onClick={() => setJourney('ingestion')}>素材入库</button>
          <button type="button" aria-pressed={journey === 'query'} onClick={() => setJourney('query')}>问题到回答</button>
        </div>
        <div className="journey-demo-label"><span className="journey-example-badge">虚构示例</span><span>{journey === 'query' ? `${modeNames[mode]} 路径` : '三条路径共用的素材准备'}</span></div>
      </div>

      <div className="journey-case">
        <div className="journey-case-files"><span><Video size={16} aria-hidden="true" />概念课.mp4</span><span><FileText size={16} aria-hidden="true" />课程讲义.pdf</span></div>
        <p><span>示例问题</span>视频怎样解释贝叶斯更新？请结合讲义说明。</p>
      </div>

      <ol className="journey-steps" aria-label={journey === 'ingestion' ? '素材入库步骤' : `${modeNames[mode]} 回答步骤`}>
        {steps.map((item, index) => (
          <li key={item.id}>
            <button type="button" aria-current={index === activeIndex ? 'step' : undefined} onClick={() => goToStep(index)}>
              <span className={`journey-step-marker ${index < activeIndex ? 'is-complete' : ''}`}>{index < activeIndex ? <Check size={13} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}</span>
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="journey-workspace">
        <div className="journey-step-detail">
          <h3>{step.title}</h3>
          <p>{step.description}</p>
          <div className="journey-action"><span>这一阶段</span><code>{step.action}</code></div>
          <div className="journey-controls" role="group" aria-label="控制步骤演示">
            <button type="button" aria-label="上一步" disabled={activeIndex === 0} onClick={() => goToStep(activeIndex - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <button type="button" className="journey-play" aria-pressed={playing} disabled={reducedMotion} onClick={() => {
              if (!playing && activeIndex === steps.length - 1) setStepIndex(0)
              setPlaying(value => !value)
            }}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? '暂停' : activeIndex === steps.length - 1 ? '重新演示' : '播放演示'}</button>
            <button type="button" aria-label="下一步" disabled={activeIndex === steps.length - 1} onClick={() => goToStep(activeIndex + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>
          <p className="journey-play-hint">{reducedMotion ? '已遵循减少动态效果偏好，请逐步查看。' : '点击步骤自由查看，播放每 5 秒前进一步。'}</p>
          <p className="journey-status" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">{journey === 'ingestion' ? '素材入库' : modeNames[mode]}：第 {activeIndex + 1} 步，{step.label}</p>
        </div>

        <div className="journey-evidence-area">
          <div className="journey-evidence-heading"><h3 ref={evidenceTitle} tabIndex={-1}>{isAnswer ? '有来处的回答' : step.view === 'indexed' ? '同一来源，两种存储职责' : '随步骤展开的证据'}</h3><span>{isAnswer ? '点击引用回到来源' : '来源身份始终保留'}</span></div>

          {isAnswer ? (
            <div className="journey-answer">
              <span className="journey-answer-label">示例回答</span>
              <p>视频用“先验 × 新证据 → 后验”解释贝叶斯更新：新证据改变原有判断，归一化后得到新的概率。<button type="button" className="journey-inline-citation" aria-label="查看 E-01 视频转写来源" onClick={() => openCitation('E-01')}>[1]</button></p>
              <p>讲义给出同一关系：后验概率由似然与先验共同决定。<button type="button" className="journey-inline-citation" aria-label="查看 E-02 讲义原文来源" onClick={() => openCitation('E-02')}>[2]</button></p>
              {showObservation && (
                <EvidenceExcerpt kind="observation">
                  对指定视频区间的采样观察中，画面展示了先验、证据与后验之间的箭头关系。
                  <button type="button" className="journey-inline-citation" aria-label="查看 E-03 视频模型观察来源" onClick={() => openCitation('E-03')}>[3]</button>
                  {' '}这份观察与转写和原文分别记录。
                </EvidenceExcerpt>
              )}
              <div className="journey-citation-list">
                <button type="button" onClick={() => openCitation('E-01')}>
                  <Video size={15} aria-hidden="true" />
                  <span><b>[1] E-01 · 视频转写</b><small>概念课.mp4 · 02:18—02:42</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => openCitation('E-02')}>
                  <FileText size={15} aria-hidden="true" />
                  <span><b>[2] E-02 · 讲义原文</b><small>课程讲义.pdf · 第 7 页</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                {showObservation && (
                  <button type="button" onClick={() => openCitation('E-03')}>
                    <Video size={15} aria-hidden="true" />
                    <span><b>[3] E-03 · 模型观察</b><small>同一视频来源 · 指定区间的采样观察</small></span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <article ref={videoEvidence} tabIndex={-1} aria-label="E-01 视频来源片段" className={`journey-evidence-record ${focusedEvidence === 'E-01' ? 'is-focused' : ''}`}>
                <div className="journey-record-identity"><span className="journey-evidence-id">E-01</span><span>概念课.mp4</span><span className="journey-record-location">02:18—02:42</span></div>
                {['files', 'scope', 'observed'].includes(step.view) && <VideoFrame showDiagram={step.view === 'observed'} />}
                {step.view !== 'files' && step.view !== 'scope' && <EvidenceExcerpt kind="transcript">“先验与新证据相乘，再归一化得到后验。”</EvidenceExcerpt>}
                {step.view === 'parsed' && <div className="journey-derived-note"><span>镜头描述 · 入库生成</span><p>讲师展示贝叶斯更新关系的示意图。模型描述与语音转写分别保存。</p></div>}
                {step.view === 'located' && <p className="journey-location-note">来源 VIDEO-01 · 镜头 Shot-04 · 时间定位 138—162 秒</p>}
                {step.view === 'indexed' && <div className="journey-storage-pair"><div><span>MinIO</span><p>原视频、关键帧、解析清单</p></div><ArrowRight size={16} aria-hidden="true" /><div><span>Qdrant</span><p>Shot 描述 / ASR 的 Dense + Sparse</p></div></div>}
                {step.view === 'context' && <div className="journey-context-note"><Check size={14} aria-hidden="true" /><span>带来源位置进入上下文 · 回答引用 [1]</span></div>}
              </article>

              {showLecture ? (
                <article ref={lectureEvidence} tabIndex={-1} aria-label="E-02 讲义原文片段" className={`journey-evidence-record journey-evidence-record--lecture ${focusedEvidence === 'E-02' ? 'is-focused' : ''}`}>
                  <div className="journey-record-identity"><span className="journey-evidence-id">E-02</span><span>课程讲义.pdf</span><span className="journey-record-location">第 7 页</span></div>
                  <EvidenceExcerpt kind="original">“后验概率由似然与先验共同决定。”</EvidenceExcerpt>
                  {step.view === 'indexed' && <p className="journey-location-note">保留原文的 Chunk · Dense + Sparse · 来源 DOC-01</p>}
                  {step.view === 'context' && <div className="journey-context-note"><Check size={14} aria-hidden="true" /><span>保留原文进入上下文 · 回答引用 [2]</span></div>}
                </article>
              ) : <div className="journey-lecture-preview"><FileText size={18} aria-hidden="true" /><div><span>课程讲义.pdf</span><p>{step.view === 'parsed' ? '文档保留原文，独立形成文本块。' : '另一份来源，为视频解释提供文字依据。'}</p></div></div>}
              {showObservation && (
                <article ref={mediaEvidence} tabIndex={-1} aria-label="E-03 视频模型观察" className={`journey-evidence-record journey-evidence-record--observation ${focusedEvidence === 'E-03' ? 'is-focused' : ''}`}>
                  <div className="journey-record-identity">
                    <span className="journey-evidence-id">E-03</span>
                    <span>概念课.mp4 · VIDEO-01</span>
                    <span className="journey-record-location">02:18—02:42</span>
                  </div>
                  <EvidenceExcerpt kind="observation">指定区间的采样画面显示“先验 × 新证据 → 后验”。同一视频的观察与转写使用独立证据编号；采样未覆盖的帧保持未核验。</EvidenceExcerpt>
                </article>
              )}
            </>
          )}
        </div>
      </div>

      <p className="journey-example-note">内容、文件名与证据编号均为教学示例；本演示不调用模型或读取实际知识库。实际引用编号在取证时分配。</p>
    </div>
  )
}
