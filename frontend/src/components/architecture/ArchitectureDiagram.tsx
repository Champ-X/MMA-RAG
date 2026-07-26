import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, Download, Expand, Layers3, X } from 'lucide-react'

const architectureImage = '/architecture/tessmora-system-architecture.png'

const mapNotes = [
  {
    badge: 'S',
    title: '入口不是一条',
    description: 'Web / SSE、Codex Skill / CLI、飞书 WSS 与 Retrieval API 面向不同使用场景。',
    color: 'border-[#79b4b4] bg-[#dcebea] text-[#246b76] dark:border-[#35626b] dark:bg-[#2f7f93]/12 dark:text-[#87c6d0]',
  },
  {
    badge: 'R·A',
    title: '检索是共享主干',
    description: 'Retrieval Core 提供一次取证；Agent Runtime 只在其上增加规划、补查与证据收敛。',
    color: 'border-[#9fb6dd] bg-[#e5ebf6] text-[#42679d] dark:border-[#465c83] dark:bg-[#4f6fa5]/12 dark:text-[#9db8e4]',
  },
  {
    badge: 'G·K',
    title: '入库与生成分工',
    description: 'Knowledge & Ingestion 负责写入可检索语义；Generation 负责预算、引用和流式交付。',
    color: 'border-[#b8ca83] bg-[#eef0d7] text-[#65752c] dark:border-[#566432] dark:bg-[#87943f]/12 dark:text-[#c0cc7b]',
  },
  {
    badge: 'D·M',
    title: '能力由两层托底',
    description: 'Qdrant、MinIO 与可选 Redis 形成数据面；LLM Manager 按任务统一路由模型。',
    color: 'border-[#d2b2cf] bg-[#f0e5ef] text-[#765c95] dark:border-[#604d72] dark:bg-[#765c95]/12 dark:text-[#c5b1d9]',
  },
]

export function ArchitectureDiagram() {
  return (
    <section id="system-architecture" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(28rem,1.28fr)] lg:items-end lg:gap-14">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">System atlas</p>
          <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
            完整系统图，是一张分层地图
          </h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px] lg:justify-self-end">
          从上向下读取请求入口与领域职责，从下向上读取数据和模型如何提供证据。绿色箭头表示请求进入，紫色箭头表示证据回流。
        </p>
      </div>

      <Dialog.Root>
        <div className="mt-9 overflow-hidden rounded-[28px] border border-[#b9ccc6] bg-[#e9efea] shadow-[0_34px_90px_-60px_rgba(16,45,66,0.72)] dark:border-[#2b4d58] dark:bg-[#0b222c]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c5d5cf] px-4 py-3.5 dark:border-[#294a56] sm:px-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="text-sm font-semibold text-[#17384a] dark:text-[#e4efeb]">Tessmora · layered system view</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#7a8e90] dark:text-[#89a4a6]">Current implementation · ImageGen atlas</p>
              </div>
              <div className="hidden items-center gap-4 border-l border-[#c5d5cf] pl-5 font-mono text-[10px] text-[#61777a] dark:border-[#294a56] dark:text-[#9ab1b2] md:flex">
                <span className="inline-flex items-center gap-1.5"><ArrowDown className="h-3.5 w-3.5 text-[#5f8e72]" /> request flows in</span>
                <span className="inline-flex items-center gap-1.5"><ArrowUp className="h-3.5 w-3.5 text-[#765c95]" /> evidence flows in</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={architectureImage}
                download="tessmora-system-architecture.png"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[#60777b] transition-colors hover:bg-white/70 hover:text-[#17384a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70 dark:text-[#9cb2b4] dark:hover:bg-white/[0.06] dark:hover:text-white"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </a>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#102d42] px-3.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93] focus-visible:ring-offset-2 active:translate-y-0 dark:bg-[#dcebe7] dark:text-[#102d42] dark:focus-visible:ring-offset-[#0b222c]"
                >
                  <Expand className="h-3.5 w-3.5" />
                  全屏查看
                </button>
              </Dialog.Trigger>
            </div>
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label="全屏查看 Tessmora 系统架构图"
                className="group block w-full cursor-zoom-in overflow-hidden bg-[#f9f5e9] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f7f93] sm:p-3 xl:border-r xl:border-[#c5d5cf] dark:bg-[#102832] dark:xl:border-[#294a56]"
              >
                <img
                  src={architectureImage}
                  alt="Tessmora 多模态 Agentic Retrieval 系统架构图"
                  className="block h-auto w-full rounded-[18px] transition-transform duration-500 group-hover:scale-[1.004]"
                  loading="eager"
                />
              </button>
            </Dialog.Trigger>

            <aside className="grid border-t border-[#c5d5cf] dark:border-[#294a56] sm:grid-cols-2 xl:block xl:border-t-0">
              <div className="p-5 sm:col-span-2 sm:p-6 xl:col-span-1">
                <div className="flex items-center gap-2 text-[#2f7f93] dark:text-[#7fc2cf]">
                  <Layers3 className="h-4 w-4" />
                  <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em]">How to read it</h3>
                </div>
                <p className="mt-2 text-xs leading-6 text-[#6b8083] dark:text-[#9db3b5]">先看四个领域柱，再看它们共同依赖的数据面与模型面。</p>
              </div>
              {mapNotes.map((note, index) => (
                <div
                  key={note.title}
                  className={`border-t border-[#c8d7d1] p-5 dark:border-[#294a56] ${index % 2 === 1 ? 'sm:border-l xl:border-l-0' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 min-w-9 items-center justify-center rounded-xl border px-2 font-mono text-[10px] font-bold ${note.color}`}>{note.badge}</span>
                    <div>
                      <h4 className="text-[13px] font-semibold text-[#18394a] dark:text-[#e4efeb]">{note.title}</h4>
                      <p className="mt-1.5 text-xs leading-6 text-[#6a7f82] dark:text-[#99b0b2]">{note.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </aside>
          </div>
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[#06141c]/90 backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-3 focus:outline-none sm:p-6">
            <Dialog.Title className="sr-only">Tessmora 系统架构图</Dialog.Title>
            <Dialog.Description className="sr-only">
              查看完整尺寸的 Tessmora 多模态 Agentic Retrieval 系统架构图。
            </Dialog.Description>
            <div className="relative max-h-[94dvh] max-w-[96vw] overflow-auto rounded-[24px] border border-white/15 bg-[#071a24] p-2 shadow-2xl sm:p-3">
              <img
                src={architectureImage}
                alt="Tessmora 多模态 Agentic Retrieval 系统架构图全屏视图"
                className="block h-auto min-w-[980px] max-w-none rounded-[18px] lg:min-w-0 lg:max-h-[88dvh] lg:max-w-[92vw]"
              />
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭架构图全屏视图"
                  className="fixed right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#071a24]/85 text-white shadow-lg backdrop-blur transition-colors hover:bg-[#17384a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fc2cf]"
                >
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
