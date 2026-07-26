import * as Dialog from '@radix-ui/react-dialog'
import { Download, Expand, X } from 'lucide-react'

const architectureImage = '/architecture/tessmora-system-architecture.png'

const mapNotes = [
  {
    title: '接入与分流',
    description: 'Web 与 CLI 进入三态路由，飞书当前保持直接检索。',
  },
  {
    title: '共享证据主干',
    description: 'Direct 与 Agent 复用同一个 Retrieval Core 和引用合同。',
  },
  {
    title: '读写边界',
    description: 'Qdrant 提供检索向量，MinIO 为上下文补充原始媒体。',
  },
]

export function ArchitectureDiagram() {
  return (
    <section id="system-architecture" className="scroll-mt-24">
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-3xl">
          一张图看清系统主干
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
          架构图把在线问答与离线入库分开，同时标出 Direct 和 Agent 如何共享检索、引用与生成层。
        </p>
      </div>

      <Dialog.Root>
        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_30px_90px_-65px_rgba(15,23,42,0.7)] dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 sm:px-5">
            <div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Tessmora 系统架构</p>
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">ImageGen 绘制，结构按当前实现校准</p>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={architectureImage}
                download="tessmora-system-architecture.png"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </a>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:translate-y-0 dark:bg-slate-100 dark:text-slate-950 dark:focus-visible:ring-offset-slate-900"
                >
                  <Expand className="h-3.5 w-3.5" />
                  全屏查看
                </button>
              </Dialog.Trigger>
            </div>
          </div>

          <Dialog.Trigger asChild>
            <button
              type="button"
              aria-label="全屏查看 Tessmora 系统架构图"
              className="group block w-full cursor-zoom-in overflow-hidden bg-[#f7faf8] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500 dark:bg-slate-950 sm:p-3"
            >
              <img
                src={architectureImage}
                alt="Tessmora 多模态 Agentic Retrieval 系统架构图"
                className="block h-auto w-full rounded-xl transition-transform duration-300 group-hover:scale-[1.005]"
                loading="eager"
              />
            </button>
          </Dialog.Trigger>

          <dl className="grid border-t border-slate-200/80 dark:border-slate-800 md:grid-cols-3">
            {mapNotes.map((note, index) => (
              <div
                key={note.title}
                className={index === 0 ? 'p-4 sm:p-5' : 'border-t border-slate-200/80 p-4 dark:border-slate-800 sm:p-5 md:border-l md:border-t-0'}
              >
                <dt className="text-xs font-semibold text-slate-900 dark:text-slate-100">{note.title}</dt>
                <dd className="mt-1.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{note.description}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-3 focus:outline-none sm:p-6">
            <Dialog.Title className="sr-only">Tessmora 系统架构图</Dialog.Title>
            <Dialog.Description className="sr-only">
              查看完整尺寸的 Tessmora 多模态 Agentic Retrieval 系统架构图。
            </Dialog.Description>
            <div className="relative max-h-[94dvh] max-w-[96vw] overflow-auto rounded-2xl border border-white/15 bg-slate-950 p-2 shadow-2xl sm:p-3">
              <img
                src={architectureImage}
                alt="Tessmora 多模态 Agentic Retrieval 系统架构图全屏视图"
                className="block h-auto min-w-[980px] max-w-none rounded-xl lg:min-w-0 lg:max-h-[88dvh] lg:max-w-[92vw]"
              />
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭架构图全屏视图"
                  className="fixed right-5 top-5 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-slate-950/80 text-white shadow-lg backdrop-blur transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
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
