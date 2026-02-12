import { X, Eye } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CitationReference } from '@/types/sse'

interface InspectorDrawerProps {
  isOpen: boolean
  onClose: () => void
  /** 当前检查的引用项 */
  citations?: CitationReference[]
}

function MetaRow({ k, v }: { k: string; v: string | number | undefined }) {
  return (
    <div className="grid grid-cols-[78px_1fr] gap-2">
      <div className="text-slate-500 dark:text-slate-400">{k}</div>
      <div className="truncate text-slate-800 dark:text-slate-100">{v ?? '-'}</div>
    </div>
  )
}

function normalizeContextWindow(raw: unknown): { prev: string; next: string } | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return normalizeContextWindow(JSON.parse(raw))
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const prev = typeof obj.prev === 'string' ? obj.prev : ''
    const next = typeof obj.next === 'string' ? obj.next : ''
    if (prev || next) return { prev, next }
  }
  return null
}

export function InspectorDrawer({
  isOpen,
  onClose,
  citations = [],
}: InspectorDrawerProps) {
  const item = citations[0] || null
  const contextWindow = normalizeContextWindow(item?.debug_info?.context_window)
  const prevText = contextWindow?.prev ?? ''
  const nextText = contextWindow?.next ?? ''

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.div
            className="absolute right-0 top-0 h-full w-[560px] max-w-[92vw] border-l border-slate-200/70 bg-white/85 shadow-2xl shadow-slate-900/20 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/70"
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 30, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-800/70">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  检查器
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {item?.file_name || '未知文件'} · Score{' '}
                  {item?.scores?.rerank?.toFixed(2) || item?.scores?.dense?.toFixed(2) || '0.00'}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-900/5 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100"
                aria-label="关闭抽屉"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ScrollArea className="h-full overflow-y-auto p-4 pb-24">
              {!item ? (
                <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                  点击引用编号查看来源
                </div>
              ) : (
                <>
                  {item.type === 'image' && item.img_url && (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/70">
                      <img
                        src={item.img_url}
                        alt={item.file_name}
                        className="w-full h-auto object-contain"
                      />
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800/70 dark:bg-slate-950/40">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      元数据
                    </div>
                    <div className="mt-3 grid gap-2 text-xs">
                      <MetaRow k="File" v={item.file_name} />
                      <MetaRow k="Path" v={item.file_path || item.file_name} />
                      <MetaRow k="Type" v={item.type} />
                      <MetaRow
                        k="Chunk ID"
                        v={item.debug_info?.chunk_id ?? '(未提供)'}
                      />
                      <MetaRow
                        k="说明"
                        v={item.debug_info?.chunk_id ? '向量库 point id，用于上下文窗口查询' : '缺少 point id 时无法拉取上一段/下一段'}
                      />
                      <MetaRow k="Vector ID" v={`vec_${item.id}`} />
                      <MetaRow
                        k="Score"
                        v={item.scores?.rerank?.toFixed(3) || item.scores?.dense?.toFixed(3) || '0.000'}
                      />
                      <MetaRow
                        k="File Type"
                        v={
                          item.file_name
                            ?.split('.')
                            .pop()
                            ?.toUpperCase() || 'UNKNOWN'
                        }
                      />
                      <MetaRow k="KB ID" v={item.debug_info?.kb_id ?? '-'} />
                      <MetaRow
                        k="Vector Dim"
                        v={item.type === 'image' ? 'CLIP: 768, Text: 4096' : 'Text: 4096'}
                      />
                    </div>
                  </div>

                  {item.type === 'image' ? (
                    <>
                      {item.content && (
                        <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800/70 dark:bg-slate-950/40">
                          <div className="flex items-center gap-2 mb-3">
                            <Eye size={14} className="text-purple-600 dark:text-purple-400" />
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              VLM Caption
                            </div>
                          </div>
                          <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                            {item.content}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800/70 dark:bg-slate-950/40">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                          内容片段
                        </div>
                        <pre className="whitespace-pre-wrap rounded-xl bg-slate-900/5 p-3 text-xs text-slate-800 dark:bg-white/5 dark:text-slate-100">
                          {item.content || '无内容'}
                        </pre>
                      </div>
                      {/* doc 类型始终展示上下文窗口（根据 context_window 展示上一 chunk / 下一 chunk） */}
                      <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white/60 p-4 dark:border-slate-800/70 dark:bg-slate-950/40">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                          上下文窗口
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                          上一 chunk
                        </div>
                        <pre className="whitespace-pre-wrap rounded-xl bg-slate-900/5 p-2 text-[10px] text-slate-600 dark:bg-white/5 dark:text-slate-300 mb-2">
                          {prevText || '（无上一段）'}
                        </pre>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                          当前片段
                        </div>
                        <pre className="whitespace-pre-wrap rounded-xl bg-indigo-50 dark:bg-indigo-900/20 p-2 text-[10px] text-slate-800 dark:bg-white/5 dark:text-slate-100 border border-indigo-200 dark:border-indigo-800 mb-2">
                          {item.content || '无内容'}
                        </pre>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                          下一 chunk
                        </div>
                        <pre className="whitespace-pre-wrap rounded-xl bg-slate-900/5 p-2 text-[10px] text-slate-600 dark:bg-white/5 dark:text-slate-300">
                          {nextText || '（无下一段）'}
                        </pre>
                      </div>
                    </>
                  )}
                </>
              )}
            </ScrollArea>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default InspectorDrawer
