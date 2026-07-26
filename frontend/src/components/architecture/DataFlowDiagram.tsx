import { ArrowRight, Database, HardDrive, RadioTower, ServerCog } from 'lucide-react'
import { dataFlowLanes } from '@/data/architectureData'

const laneMeta = {
  ingestion: {
    icon: HardDrive,
    label: '写入路径',
    accent: 'text-orange-700 dark:text-orange-300',
    surface: 'border-orange-200/80 bg-orange-50/55 dark:border-orange-900/70 dark:bg-orange-950/15',
  },
  query: {
    icon: RadioTower,
    label: '读取路径',
    accent: 'text-teal-700 dark:text-teal-300',
    surface: 'border-teal-200/80 bg-teal-50/55 dark:border-teal-900/70 dark:bg-teal-950/15',
  },
}

export function DataFlowDiagram() {
  return (
    <section id="data-flow" className="scroll-mt-24">
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-3xl">
          写入和读取，各走自己的路径
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
          离线链路负责固化对象与索引，在线链路只读取证据并组装引用。Redis / Celery 只位于任务控制面。
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {dataFlowLanes.map((lane) => {
          const meta = laneMeta[lane.id]
          const Icon = meta.icon

          return (
            <div key={lane.id} className={`rounded-2xl border p-5 sm:p-6 ${meta.surface}`}>
              <div className="grid gap-6 xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-center">
                <div>
                  <div className={`flex items-center gap-2 text-xs font-semibold ${meta.accent}`}>
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">{lane.title}</h3>
                  <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{lane.description}</p>
                </div>

                <ol className="flex flex-col lg:flex-row lg:items-stretch">
                  {lane.stages.map((stage, index) => (
                    <li key={stage.title} className="contents">
                      <div className="min-w-0 flex-1 rounded-xl border border-white/80 bg-white/85 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{stage.title}</div>
                        <div className="mt-1.5 text-[10px] leading-5 text-slate-500 dark:text-slate-400">{stage.detail}</div>
                      </div>
                      {index < lane.stages.length - 1 ? (
                        <div className="flex h-7 items-center justify-center text-slate-400 lg:h-auto lg:w-6 lg:shrink-0">
                          <ArrowRight className="h-3.5 w-3.5 rotate-90 lg:rotate-0" />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="border-b border-slate-200/80 px-5 py-3 text-xs font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
          共享数据面
        </div>
        <dl className="grid md:grid-cols-3">
          <SharedCell icon={<Database className="h-4 w-4" />} title="Qdrant" detail="语义与专用向量，在线检索的主要读取面。" />
          <SharedCell icon={<HardDrive className="h-4 w-4" />} title="MinIO" detail="原始对象、关键帧、manifest 与媒体 URL。" bordered />
          <SharedCell icon={<ServerCog className="h-4 w-4" />} title="Redis / Celery" detail="导入任务控制面，不位于检索结果链中。" bordered />
        </dl>
      </div>
    </section>
  )
}

function SharedCell({
  icon,
  title,
  detail,
  bordered = false,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  bordered?: boolean
}) {
  return (
    <div className={bordered ? 'border-t border-slate-200/80 p-5 dark:border-slate-800 md:border-l md:border-t-0' : 'p-5'}>
      <dt className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
        <span className="text-teal-600 dark:text-teal-400">{icon}</span>
        {title}
      </dt>
      <dd className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{detail}</dd>
    </div>
  )
}
