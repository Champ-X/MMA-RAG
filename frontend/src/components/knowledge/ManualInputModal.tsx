import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, Pencil, Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MdEditor, type ToolbarNames } from 'md-editor-rt'
import 'md-editor-rt/lib/style.css'
import './ManualInputModal.css'

interface ManualInputModalProps {
  open: boolean
  mode: 'create' | 'edit'
  initialFilename?: string
  initialContent?: string
  onClose: () => void
  onSubmit: (payload: { filename: string; content: string }) => Promise<void>
}

function normalizeManualFilename(filename: string): string {
  const trimmed = filename.replace(/\\/g, '/').split('/').pop()?.trim() || ''
  if (!trimmed) return '未命名文档.md'
  if (trimmed.toLowerCase().endsWith('.md')) return trimmed
  const stem = trimmed.replace(/\.[^.]+$/, '')
  return `${stem || '未命名文档'}.md`
}

export function ManualInputModal({
  open,
  mode,
  initialFilename = '未命名文档.md',
  initialContent = '',
  onClose,
  onSubmit,
}: ManualInputModalProps) {
  const [filename, setFilename] = useState(initialFilename)
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    if (!open) return
    setFilename(initialFilename)
    setContent(initialContent)
    setSaving(false)
    setError(null)
  }, [open, initialFilename, initialContent])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const syncTheme = () => {
      setEditorTheme(root.classList.contains('dark') ? 'dark' : 'light')
    }
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const dialogTitle = mode === 'create' ? '手动输入上传' : '编辑手动文档'
  const submitLabel = mode === 'create' ? '提交入库' : '保存并重新处理'
  const helperText = useMemo(
    () =>
      mode === 'create'
        ? '提交后会按 Markdown 文档走现有上传、分块和向量化流程。'
        : '保存后会重新入库，并在新内容处理成功后删除旧数据。',
    [mode]
  )

  const toolbarItems = useMemo<ToolbarNames[]>(
    () => [
      'revoke',
      'next',
      '=',
      'bold',
      'underline',
      'italic',
      'strikeThrough',
      'quote',
      '=',
      'title',
      'unorderedList',
      'orderedList',
      'task',
      '=',
      'codeRow',
      'code',
      'table',
      'link',
      '=',
      'preview',
      'previewOnly',
      'fullscreen',
      'pageFullscreen',
      'catalog',
    ],
    []
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedFilename = normalizeManualFilename(filename)
    if (!content.trim()) {
      setError('请输入文档内容后再提交。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ filename: normalizedFilename, content })
    } catch (err: any) {
      setError(err?.message || '提交失败，请稍后重试。')
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && !next && onClose()}>
      <DialogContent className="max-w-6xl overflow-hidden rounded-[30px] border border-slate-200/90 bg-white p-0 shadow-[0_32px_100px_-28px_rgba(15,23,42,0.5)] dark:border-slate-800 dark:bg-slate-950">
        <form onSubmit={handleSubmit} className="flex max-h-[90vh] min-h-[78vh] flex-col overflow-hidden">
          <div className="rounded-t-[30px] border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_28%),linear-gradient(135deg,rgba(248,250,252,1),rgba(255,255,255,1)_48%,rgba(238,242,255,0.85))] px-7 py-6 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_right,rgba(129,140,248,0.18),transparent_30%),linear-gradient(135deg,rgba(15,23,42,1),rgba(2,6,23,1)_55%,rgba(49,46,129,0.2))]">
            <DialogHeader className="text-left">
              <div className="flex min-w-0 items-start gap-4">
                <span className="mt-0.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-100 bg-white text-indigo-600 shadow-sm dark:border-indigo-500/20 dark:bg-slate-900 dark:text-indigo-300">
                  {mode === 'create' ? <FileText className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="text-[1.35rem] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                      {dialogTitle}
                    </DialogTitle>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/70 bg-indigo-50/85 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-950/35 dark:text-indigo-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      Markdown 编辑器
                    </span>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{helperText}</p>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.86))] px-7 py-4 dark:bg-[linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,0.92))]">
            <div className="space-y-4">
              <div className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="mb-2.5 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">文档名称</label>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">|</span>
                      <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100">Markdown 编辑器</span>
                    </div>
                    <input
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                      placeholder="例如：会议纪要.md"
                      disabled={saving}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-500/50"
                    />
                  </div>
                </div>

                <div className="manual-input-md-editor overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[0_16px_40px_-24px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-950">
                  <MdEditor
                    id={`manual-input-${mode}`}
                    modelValue={content}
                    onChange={(value) => setContent(value)}
                    className="manual-input-md-editor__inner"
                    theme={editorTheme}
                    language="zh-CN"
                    previewTheme="github"
                    codeTheme="github"
                    preview
                    autoFocus={mode === 'create'}
                    disabled={saving}
                    noUploadImg
                    noPrettier
                    showCodeRowNumber
                    autoDetectCode
                    toolbars={toolbarItems}
                    footers={['markdownTotal', '=', 'scrollSwitch']}
                    placeholder="# 标题\n\n在这里输入要入库的 Markdown 内容..."
                    style={{ height: '58vh' }}
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-white/90 px-7 py-5 dark:border-slate-800 dark:bg-slate-950/90">
            <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              {mode === 'create'
                ? '提交后将沿用现有上传、分块与向量化流程。'
                : '保存后会先完成新内容入库，再清理旧文件数据。'}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:from-indigo-500 hover:to-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? '处理中…' : submitLabel}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default ManualInputModal
