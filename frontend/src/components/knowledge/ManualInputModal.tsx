import { useEffect, useId, useMemo, useState } from 'react'
import { FileText, Loader2, Pencil } from 'lucide-react'
import { WorkflowDialog } from '@/components/ui/WorkflowDialog'
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

function getSubmitErrorMessage(error: unknown) {
  if (typeof error === 'object' && error != null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message) return message
  }
  return '提交失败，请稍后重试。'
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
  const [compactEditor, setCompactEditor] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 600)
  const modalId = useId().replace(/:/g, '')

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

  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)')
    const update = () => setCompactEditor(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const dialogTitle = mode === 'create' ? '新建 Markdown 文档' : '编辑 Markdown 文档'
  const submitLabel = mode === 'create' ? '提交入库' : '保存并重新处理'
  const filenameInputId = `${modalId}-manual-input-filename`
  const filenameHintId = `${modalId}-manual-input-filename-hint`
  const editorRegionId = `${modalId}-manual-input-editor`
  const errorTextId = `${modalId}-manual-input-error`
  const statusTextId = `${modalId}-manual-input-status`
  const normalizedFilename = normalizeManualFilename(filename)
  const contentCharCount = content.trim().length
  const statusText = saving
    ? `${submitLabel}处理中，请稍候`
    : `当前文档 ${contentCharCount} 个有效字符，提交时保存为 ${normalizedFilename}`
  const helperText = useMemo(
    () =>
      mode === 'create'
        ? '直接记录想法与资料，预览排版后添加到当前素材空间。'
        : '修改文档内容；保存后会重新处理并替换原文档。',
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
    } catch (err: unknown) {
      setError(getSubmitErrorMessage(err))
      setSaving(false)
    }
  }

  return (
    <WorkflowDialog
      eyebrow="素材创作"
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title={dialogTitle}
      description={helperText}
      icon={mode === 'create' ? <FileText /> : <Pencil />}
      size="xl"
      className="manual-input-dialog"
      busy={saving}
      onSubmit={handleSubmit}
      footer={<>
        <span className="workflow-footer-summary" id={statusTextId} aria-live="polite">
          {saving ? statusText : `${contentCharCount} 字 · ${normalizedFilename}`}
        </span>
        <div className="workflow-footer-actions">
          <button type="button" onClick={onClose} disabled={saving} className="workflow-button" aria-label="取消手动文档输入并关闭弹窗">取消</button>
          <button type="submit" disabled={saving || !content.trim()} className="workflow-button-primary" aria-describedby={statusTextId}>
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {saving ? '处理中…' : submitLabel}
          </button>
        </div>
      </>}
    >
      <div className="manual-input-name">
        <label htmlFor={filenameInputId} className="workflow-label">文档名称</label>
        <input id={filenameInputId} value={filename} onChange={(event) => setFilename(event.target.value)}
          placeholder="例如：会议纪要.md" disabled={saving} data-autofocus className="workflow-field"
          aria-describedby={filenameHintId} />
        <p id={filenameHintId} className="workflow-help">保存为 {normalizedFilename}</p>
      </div>
      <section id={editorRegionId} className="manual-input-md-editor" aria-label="Markdown 文档内容编辑器">
        <MdEditor
          id={`manual-input-${mode}`}
          modelValue={content}
          onChange={(value) => setContent(value)}
          className="manual-input-md-editor__inner"
          theme={editorTheme}
          language="zh-CN"
          previewTheme="github"
          codeTheme="github"
          preview={!compactEditor}
          autoFocus={false}
          disabled={saving}
          noUploadImg
          noImgZoomIn
          noPrettier
          showCodeRowNumber
          autoDetectCode
          toolbars={toolbarItems}
          footers={['markdownTotal', '=', 'scrollSwitch']}
          placeholder={'# 标题\n\n在这里写下要保存的内容…'}
        />
      </section>
      {error && <p id={errorTextId} role="alert" className="manual-input-error">{error}</p>}
    </WorkflowDialog>
  )
}

export default ManualInputModal
