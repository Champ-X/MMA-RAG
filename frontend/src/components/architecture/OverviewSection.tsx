import { Aperture, Check, GitFork, Layers3, LockKeyhole, Route } from 'lucide-react'

const designPrinciples = [
  {
    icon: Aperture,
    label: 'Modal-native ingestion',
    title: '先尊重模态，再统一证据',
    description: '文档保留章节与表格，图片保留视觉语义，音频保留转写与声学线索，视频先拆 Scene / Shot / Key Frame；不会为了统一而抹平原始证据。',
    color: 'blue',
  },
  {
    icon: Layers3,
    label: 'Retrieval as substrate',
    title: '检索器是共享底座',
    description: 'Direct 与 Agent 不维护两套召回逻辑：两者都复用画像路由、Dense / Sparse / Visual 召回、RRF 融合与 Cross-Encoder 精排，只改变取证次数。',
    color: 'green',
  },
  {
    icon: LockKeyhole,
    label: 'Bounded agency',
    title: 'Agent 只增加深度',
    description: 'Planner 只能调用只读检索工具；轮数、每轮子查询数、总查询数与证据池容量均有硬上限，因此深研可以解释、可以停止、也可以回退。',
    color: 'orange',
  },
  {
    icon: Route,
    label: 'Evidence-native delivery',
    title: '回答天然可追溯',
    description: '所有路径都汇入 RetrievalResult 与 ReferenceMap：引用编号、媒体定位、上下文窗口和最终回答沿同一 SSE 事件流送达，不在生成阶段补造来源。',
    color: 'purple',
  },
] as const

const invariants = [
  'KB / File 范围在所有子查询中原样透传',
  'Agent 只调用只读多模态检索工具',
  '两条路径输出同一种 RetrievalResult',
  '轮数、查询数与证据池都有硬预算',
]

const colorStyles = {
  blue: 'border-[#9ec2cc] bg-[#e7f1f2] text-[#2f7f93] dark:border-[#315c68] dark:bg-[#2f7f93]/10 dark:text-[#85c5d0]',
  green: 'border-[#afcbb8] bg-[#e8f0e8] text-[#5f8e72] dark:border-[#3d624d] dark:bg-[#5f8e72]/10 dark:text-[#91c3a1]',
  orange: 'border-[#e5b89d] bg-[#f6e8dc] text-[#d76f43] dark:border-[#754b37] dark:bg-[#e47b4e]/10 dark:text-[#eeaa88]',
  purple: 'border-[#c6b8d2] bg-[#eee9f2] text-[#765c95] dark:border-[#59476e] dark:bg-[#765c95]/10 dark:text-[#c2add6]',
} as const

export function OverviewSection() {
  return (
    <section id="overview" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(32rem,1.22fr)] lg:items-end lg:gap-14">
        <div className="max-w-xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">Design doctrine</p>
          <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
            <span className="block sm:inline">四条约束，</span>
            <span className="block sm:inline">定义可控的多模态检索</span>
          </h2>
          <p className="mt-4 text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px]">
            Tessmora 的重点不是把 Agent 叠在 RAG 前面，而是先定义哪些信息必须保留、哪些能力必须复用、哪些动作必须受限，以及答案如何带着证据交付。
          </p>
        </div>

        <div className="rounded-[22px] border border-[#c5d6d0] bg-white/45 px-5 py-4 dark:border-[#294a56] dark:bg-white/[0.025] sm:px-6">
          <div className="flex items-center gap-3">
            <GitFork className="h-4 w-4 text-[#765c95] dark:text-[#c2add6]" />
            <p className="text-sm font-semibold text-[#17384a] dark:text-[#e6f0ed]">变化的是取证深度，不变的是证据边界</p>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-[#687d81] dark:text-[#9db4b5]">
            Direct 只调用一次 RetrievalService；Agent 只是在同一服务之上规划互补子查询、合并新证据并按预算停止。无论走哪条路，交付物始终是同一种可引用证据对象。
          </p>
        </div>
      </div>

      <div className="mt-9 grid overflow-hidden rounded-[26px] border border-[#bfd0ca] bg-[#edf2ed] dark:border-[#294a56] dark:bg-[#0b222c] md:grid-cols-2 xl:grid-cols-4">
        {designPrinciples.map((principle, index) => {
          const Icon = principle.icon
          return (
            <article
              key={principle.label}
              className={`group relative min-h-[14rem] p-5 sm:min-h-[18rem] sm:p-6 ${index > 0 ? 'border-t border-[#c8d7d1] dark:border-[#294a56] md:border-t-0 md:border-l' : ''} ${index === 2 ? 'md:border-l-0 md:border-t xl:border-l xl:border-t-0' : ''}`}
            >
              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${colorStyles[principle.color]}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-8 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#718487] dark:text-[#87a2a4]">
                {principle.label}
              </p>
              <h3 className="architecture-display mt-2 text-xl font-semibold tracking-[-0.025em] text-[#17384a] dark:text-[#e7f1ee]">
                {principle.title}
              </h3>
              <p className="mt-3 text-[13px] leading-6 text-[#63797d] dark:text-[#9db3b5]">{principle.description}</p>
              <span aria-hidden className="absolute bottom-0 left-0 h-1 w-0 bg-[#2f7f93] transition-all duration-300 group-hover:w-full dark:bg-[#7fc2cf]" />
            </article>
          )
        })}
      </div>

      <aside className="mt-5 grid gap-5 rounded-[22px] bg-[#102d42] p-5 text-white shadow-[0_24px_60px_-44px_rgba(16,45,66,0.95)] sm:p-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-[#92d0d7]">
            <LockKeyhole className="h-4 w-4" />
            <h3 className="text-sm font-semibold">不可破坏的系统约束</h3>
          </div>
          <p className="mt-2 text-xs leading-6 text-[#9eb5ba]">这些约束使 Agent 能力保持可控、可解释、可回退。</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {invariants.map((item) => (
            <li key={item} className="flex gap-2.5 text-xs leading-6 text-[#d6e4e1]">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#5f8e72] text-white">
                <Check className="h-2.5 w-2.5" />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
