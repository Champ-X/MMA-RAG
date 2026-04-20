import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckSquare, ChevronDown, FileText, FolderTree, Search, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ChatScopeFile } from '@/store/useChatStore'
import { fileScopeKey, formatScopedFileSize, useFileScopeOptions } from './useFileScopeOptions'
import type { KnowledgeBaseFileItem } from './useFileScopeOptions'

interface FileScopePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: ChatScopeFile[]
  onChange: (files: ChatScopeFile[]) => void
}

export function FileScopePicker({ open, onOpenChange, value, onChange }: FileScopePickerProps) {
  const { knowledgeBases, filesByKb, loadingKbIds, loadKbFiles, ensureAllKbFiles, hasLoadedFilesForKb } = useFileScopeOptions(open)
  const [draftSelection, setDraftSelection] = useState<ChatScopeFile[]>([])
  const [query, setQuery] = useState('')
  const [expandedKbIds, setExpandedKbIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setDraftSelection(value)
    setQuery('')
  }, [open, value])

  useEffect(() => {
    if (!open) return
    if (!query.trim()) return
    void ensureAllKbFiles()
  }, [open, query, ensureAllKbFiles])

  useEffect(() => {
    if (!open) return
    void ensureAllKbFiles()
  }, [open, ensureAllKbFiles])

  const selectedKeySet = useMemo(
    () => new Set(draftSelection.map(file => fileScopeKey(file.kbId, file.fileId))),
    [draftSelection]
  )

  const hasSearch = query.trim().length > 0

  const knowledgeBaseGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return knowledgeBases
      .map(kb => {
        const files = filesByKb[kb.id] ?? []
        const matches = !keyword
          ? files
          : files.filter(file => {
              const haystack = `${file.name} ${file.type}`.toLowerCase()
              return haystack.includes(keyword)
            })
        return {
          kb,
          files,
          matches,
          isExpanded: hasSearch || expandedKbIds.includes(kb.id),
          isLoading: loadingKbIds.includes(kb.id),
          hasLoaded: hasLoadedFilesForKb(kb.id),
        }
      })
      .filter(group => !hasSearch || group.matches.length > 0 || group.isLoading || !group.hasLoaded)
  }, [knowledgeBases, filesByKb, query, expandedKbIds, loadingKbIds, hasSearch, hasLoadedFilesForKb])

  const toggleKb = useCallback((kbId: string) => {
    setExpandedKbIds(prev => {
      if (prev.includes(kbId)) return prev.filter(id => id !== kbId)
      return [...prev, kbId]
    })
    if (!filesByKb[kbId]) {
      void loadKbFiles(kbId)
    }
  }, [filesByKb, loadKbFiles])

  const toggleFile = useCallback((kbId: string, kbName: string, file: KnowledgeBaseFileItem) => {
    const key = fileScopeKey(kbId, file.id)
    setDraftSelection(prev => {
      if (prev.some(item => fileScopeKey(item.kbId, item.fileId) === key)) {
        return prev.filter(item => fileScopeKey(item.kbId, item.fileId) !== key)
      }
      return [
        ...prev,
        {
          kbId,
          kbName,
          fileId: file.id,
          name: file.name,
          type: file.type,
        },
      ]
    })
  }, [])

  const removeDraftFile = useCallback((file: ChatScopeFile) => {
    const key = fileScopeKey(file.kbId, file.fileId)
    setDraftSelection(prev => prev.filter(item => fileScopeKey(item.kbId, item.fileId) !== key))
  }, [])

  const applySelection = useCallback(() => {
    onChange(draftSelection)
    onOpenChange(false)
  }, [draftSelection, onChange, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200/60 bg-white/90 shadow-2xl shadow-slate-900/20 backdrop-blur-xl dark:border-slate-700/50 dark:bg-slate-950/90"
        onClick={e => e.stopPropagation()}
      >
        <DialogHeader className="flex-shrink-0 pb-2">
          <DialogTitle className="flex items-center gap-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10">
              <FolderTree className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            指定检索文件
          </DialogTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            按知识库分组选择本轮要限定检索的文件；如果选择了文件，本轮会优先只在这些文件里检索。
          </p>
        </DialogHeader>

        <div className="flex flex-shrink-0 flex-col gap-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索文件名或类型"
              className="rounded-2xl border-slate-200/70 bg-white/80 pl-9 pr-3 dark:border-slate-700/70 dark:bg-slate-900/70"
            />
          </div>

          {draftSelection.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/60 bg-slate-50/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/50">
              {draftSelection.map(file => (
                <button
                  key={fileScopeKey(file.kbId, file.fileId)}
                  type="button"
                  onClick={() => removeDraftFile(file)}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200/70 bg-white/90 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-slate-950/70 dark:text-emerald-200"
                >
                  <span className="truncate">{file.kbName ? `${file.kbName} / ${file.name}` : file.name}</span>
                  <X className="h-3.5 w-3.5 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          <div className="space-y-3 pb-2">
            {knowledgeBases.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300/70 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                暂无知识库，请先创建并导入文件。
              </div>
            ) : knowledgeBaseGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300/70 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                没有匹配的文件。
              </div>
            ) : (
              knowledgeBaseGroups.map(({ kb, files, matches, isExpanded, isLoading, hasLoaded }) => (
                <div
                  key={kb.id}
                  className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60"
                >
                  <button
                    type="button"
                    onClick={() => toggleKb(kb.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/60"
                  >
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 flex-shrink-0 text-slate-400 transition-transform',
                        isExpanded && 'rotate-180'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{kb.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {!hasLoaded
                          ? '正在加载文件数...'
                          : isLoading
                          ? '正在加载文件...'
                          : hasSearch
                            ? `${matches.length} 个匹配结果`
                            : `${files.length} 个文件`}
                      </div>
                    </div>
                    {draftSelection.some(file => file.kbId === kb.id) && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        {draftSelection.filter(file => file.kbId === kb.id).length} 已选
                      </span>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-200/60 px-3 py-2 dark:border-slate-700/60">
                      {isLoading && matches.length === 0 ? (
                        <div className="px-2 py-4 text-sm text-slate-500 dark:text-slate-400">正在拉取文件列表...</div>
                      ) : matches.length === 0 ? (
                        <div className="px-2 py-4 text-sm text-slate-500 dark:text-slate-400">
                          {hasSearch ? '当前知识库下没有匹配文件。' : '暂无可选文件。'}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {matches.map(file => {
                            const checked = selectedKeySet.has(fileScopeKey(kb.id, file.id))
                            return (
                              <button
                                key={fileScopeKey(kb.id, file.id)}
                                type="button"
                                onClick={() => toggleFile(kb.id, kb.name, file)}
                                className={cn(
                                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all',
                                  checked
                                    ? 'bg-emerald-500/10 text-emerald-900 ring-1 ring-emerald-500/20 dark:text-emerald-100'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                )}
                              >
                                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                                  <CheckSquare
                                    className={cn(
                                      'h-4 w-4',
                                      checked ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-300 dark:text-slate-600'
                                    )}
                                  />
                                </div>
                                <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">{file.name}</div>
                                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    <span>{String(file.type || 'file').toUpperCase()}</span>
                                    <span>{formatScopedFileSize(file.size)}</span>
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200/60 pt-4 dark:border-slate-800/60">
          <Button
            variant="ghost"
            onClick={() => setDraftSelection([])}
            className="rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            清空选择
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border-slate-200/80 bg-white/60 dark:border-slate-700/80 dark:bg-slate-900/60"
            >
              取消
            </Button>
            <Button
              onClick={applySelection}
              className="rounded-xl bg-emerald-500/90 text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-500"
            >
              应用 {draftSelection.length > 0 ? `(${draftSelection.length})` : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FileScopePicker
