import { ArrowRight, Database, HardDrive, RadioTower, ServerCog } from 'lucide-react'
import { dataFlowLanes } from '@/data/architectureData'

const laneMeta = {
  ingestion: {
    icon: HardDrive,
    label: '写入路径 · write',
    accent: 'text-[#d66d41] dark:text-[#eeaa88]',
    marker: 'bg-[#e47b4e]',
    rail: 'border-[#e1b296] bg-[#f5e4d7] dark:border-[#744a36] dark:bg-[#e47b4e]/10',
  },
  query: {
    icon: RadioTower,
    label: '读取路径 · read',
    accent: 'text-[#2f7f93] dark:text-[#83c4cf]',
    marker: 'bg-[#2f7f93]',
    rail: 'border-[#9fc2c7] bg-[#e2eef0] dark:border-[#35606a] dark:bg-[#2f7f93]/10',
  },
}

const sharedData = [
  { icon: Database, title: 'Qdrant', detail: '语义、稀疏与专用向量；在线检索的主要读取面。' },
  { icon: HardDrive, title: 'MinIO', detail: '原始对象、关键帧、manifest 与预签名媒体 URL。' },
  { icon: ServerCog, title: 'Redis / Celery', detail: '可选任务控制面；不参与在线检索结果合同。' },
]

export function DataFlowDiagram() {
  const ingestion = dataFlowLanes.find((lane) => lane.id === 'ingestion')
  const query = dataFlowLanes.find((lane) => lane.id === 'query')

  if (!ingestion || !query) return null

  return (
    <section id="data-flow" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(30rem,1.25fr)] lg:items-end lg:gap-14">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">Data plane</p>
          <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
            <span className="block">同一个数据面，</span>
            <span className="block">承接相反方向的数据流</span>
          </h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px] lg:justify-self-end">
          离线链路把对象转成索引并写入；在线链路只读取证据并组装引用。Redis / Celery 只承担可选的长任务控制。
        </p>
      </div>

      <div className="mt-9 overflow-hidden rounded-[28px] border border-[#b9ccc6] bg-[#edf2ed] shadow-[0_34px_90px_-64px_rgba(16,45,66,0.72)] dark:border-[#2b4d58] dark:bg-[#0b222c]">
        <FlowLane lane={ingestion} />

        <div className="relative border-y border-[#aebfba] bg-[#102d42] px-5 py-7 text-white dark:border-[#31525e] sm:px-7">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-center">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7fc2cf]">Shared data plane</p>
              <h3 className="architecture-display mt-2 text-2xl font-semibold">对象、索引与控制</h3>
              <p className="mt-2 text-xs leading-6 text-[#9eb5ba]">存储职责明确分开，读取链路不依赖异步控制面。</p>
            </div>
            <dl className="grid overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.045] sm:grid-cols-3">
              {sharedData.map((item, index) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className={index > 0 ? 'border-t border-white/10 p-4 sm:border-l sm:border-t-0' : 'p-4'}>
                    <dt className="flex items-center gap-2 text-[13px] font-semibold text-white">
                      <Icon className="h-4 w-4 text-[#8bc7cf]" />
                      {item.title}
                    </dt>
                    <dd className="mt-2 text-xs leading-5 text-[#a9bec1]">{item.detail}</dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </div>

        <FlowLane lane={query} />
      </div>
    </section>
  )
}

function FlowLane({ lane }: { lane: (typeof dataFlowLanes)[number] }) {
  const meta = laneMeta[lane.id]
  const Icon = meta.icon

  return (
    <div className="p-5 sm:p-7">
      <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)] xl:items-center">
        <div>
          <div className={`flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.accent}`}>
            <Icon className="h-4 w-4" />
            {meta.label}
          </div>
          <h3 className="architecture-display mt-2 text-2xl font-semibold text-[#102d42] dark:text-[#edf6f3]">{lane.title}</h3>
          <p className="mt-2 text-xs leading-6 text-[#687d81] dark:text-[#9db4b5]">{lane.description}</p>
        </div>

        <ol className="grid gap-2 sm:grid-cols-5" aria-label={`${lane.title}阶段`}>
          {lane.stages.map((stage, index) => (
            <li key={stage.title} className="relative flex min-w-0 sm:block">
              <div className={`relative z-10 min-h-[7.1rem] w-full rounded-[18px] border p-3 ${meta.rail}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.marker}`} />
                  <span className="font-mono text-[9px] font-semibold text-[#7a8d8f] dark:text-[#839ea0]">{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="mt-3 text-[13px] font-semibold text-[#18394a] dark:text-[#e2eeea]">{stage.title}</div>
                <div className="mt-1.5 text-xs leading-5 text-[#687d81] dark:text-[#9cb2b4]">{stage.detail}</div>
              </div>
              {index < lane.stages.length - 1 ? (
                <ArrowRight className="absolute -right-[0.45rem] top-1/2 z-20 hidden h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-[#edf2ed] text-[#718587] dark:bg-[#0b222c] dark:text-[#8ba5a7] sm:block" />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
