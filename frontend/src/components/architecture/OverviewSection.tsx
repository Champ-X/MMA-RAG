import { Aperture, Check, Layers3, LockKeyhole, Route } from 'lucide-react'
import './architectureSections.css'

const designPrinciples = [
  {
    icon: Aperture,
    tone: 'teal',
    label: 'Modal-native ingestion',
    title: '保留模态语义',
    description: '文档保留章节与表格，图片保留视觉语义，音频保留转写与声学线索，视频按 Scene / Shot / Key Frame 组织。统一证据，不抹平来源。',
  },
  {
    icon: Layers3,
    tone: 'purple',
    label: 'Shared retrieval',
    title: '复用检索底座',
    description: 'Direct 与 Agent 共用画像路由、Dense / Sparse / Visual 召回、RRF 融合与 Cross-Encoder 精排。改变取证次数，保持检索逻辑一致。',
  },
  {
    icon: LockKeyhole,
    tone: 'amber',
    label: 'Bounded agency',
    title: '让深研保持可控',
    description: 'Planner 只调用只读检索工具。轮数、每轮子查询、总查询量与证据池均有硬上限，深研过程可以解释、停止与回退。',
  },
  {
    icon: Route,
    tone: 'blue',
    label: 'Traceable delivery',
    title: '带着来源交付',
    description: '两条路径汇入 RetrievalResult 与 ReferenceMap。引用编号、媒体定位、上下文窗口和回答通过同一 SSE 流送达，生成阶段不补造来源。',
  },
] as const

const invariants = [
  'KB / File 范围原样透传',
  'Agent 工具只读',
  '统一 RetrievalResult',
  '轮数、查询与证据有预算',
]

export function OverviewSection() {
  return (
    <section id="overview" className="atlas-overview-section scroll-mt-24">
      <div className="atlas-section-intro">
        <div>
          <p className="atlas-section-kicker">Design principles / 设计原则</p>
          <h2>四条原则，守住证据边界</h2>
        </div>
        <p>Direct 一次检索；Agent 在同一服务上规划互补子查询、合并证据并按预算停止。取证可以深入，交付始终遵循同一证据约定。</p>
      </div>

      <div className="atlas-principles">
        {designPrinciples.map((principle) => {
          const Icon = principle.icon
          return (
            <article key={principle.label} className="atlas-principle" data-tone={principle.tone}>
              <div className="atlas-principle-label"><span className="atlas-principle-icon"><Icon size={21} aria-hidden="true" /></span><span>{principle.label}</span></div>
              <h3>{principle.title}</h3>
              <p>{principle.description}</p>
            </article>
          )
        })}
      </div>

      <aside className="atlas-invariants" aria-label="系统约束">
        <h3><LockKeyhole size={15} aria-hidden="true" />系统约束</h3>
        <ul>
          {invariants.map((item) => (
            <li key={item}><Check size={14} aria-hidden="true" /><span>{item}</span></li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
