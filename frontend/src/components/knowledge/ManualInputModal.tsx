import { translate as t, useTranslation, getLanguage } from '@/i18n'
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
  if (!trimmed) return t("未命名文档.md")
  if (trimmed.toLowerCase().endsWith('.md')) return trimmed
  const stem = trimmed.replace(/\.[^.]+$/, '')
  return t("{{value1}}.md", { value1: stem || t("未命名文档") })
}

function getSubmitErrorMessage(error: unknown) {
  if (typeof error === 'object' && error != null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message) return message
  }
  return t("提交失败，请稍后重试。")
}

export function ManualInputModal({
  open,
  mode,
  initialFilename,
  initialContent = '',
  onClose,
  onSubmit,
}: ManualInputModalProps) {
  useTranslation()
  const [filename, setFilename] = useState(() => initialFilename ?? t("未命名文档.md"))
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorTheme, setEditorTheme] = useState<'light' | 'dark'>('light')
  const [compactEditor, setCompactEditor] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 600)
  const modalId = useId().replace(/:/g, '')

  useEffect(() => {
    if (!open) return
    setFilename(initialFilename ?? t("未命名文档.md"))
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

  const dialogTitle = mode === 'create' ? t("新建 Markdown 文档") : t("编辑 Markdown 文档")
  const submitLabel = mode === 'create' ? t("提交入库") : t("保存并重新处理")
  const filenameInputId = `${modalId}-manual-input-filename`
  const filenameHintId = `${modalId}-manual-input-filename-hint`
  const editorRegionId = `${modalId}-manual-input-editor`
  const errorTextId = `${modalId}-manual-input-error`
  const statusTextId = `${modalId}-manual-input-status`
  const normalizedFilename = normalizeManualFilename(filename)
  const contentCharCount = content.trim().length
  const statusText = saving
    ? t("{{submitLabel}}处理中，请稍候", { submitLabel: submitLabel })
    : t("当前文档 {{contentCharCount}} 个有效字符，提交时保存为 {{normalizedFilename}}", { contentCharCount: contentCharCount, normalizedFilename: normalizedFilename })
  const helperText = mode === 'create'
    ? t("直接记录想法与资料，预览排版后添加到当前素材空间。")
    : t("修改文档内容；保存后会重新处理并替换原文档。")

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
      setError(t("请输入文档内容后再提交。"))
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
      eyebrow={t("素材创作")}
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      title={dialogTitle}
      description={helperText}
      icon={mode === 'create' ? <FileText /> : <Pencil />}
      size="xl"
      sourceTheme="document"
      className="manual-input-dialog"
      busy={saving}
      onSubmit={handleSubmit}
      footer={<>
        <span className="workflow-footer-summary" id={statusTextId} aria-live="polite">
          {saving ? statusText : t("{{contentCharCount}} 字 · {{normalizedFilename}}", { contentCharCount: contentCharCount, normalizedFilename: normalizedFilename })}
        </span>
        <div className="workflow-footer-actions">
          <button type="button" onClick={onClose} disabled={saving} className="workflow-button" aria-label={t("取消手动文档输入并关闭弹窗")}>{t("取消")}</button>
          <button type="submit" disabled={saving || !content.trim()} className="workflow-button-primary" aria-describedby={statusTextId}>
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {saving ? t("处理中…") : submitLabel}
          </button>
        </div>
      </>}
    >
      <div className="manual-input-name">
        <label htmlFor={filenameInputId} className="workflow-label">{t("文档名称")}</label>
        <span className="manual-input-format">Markdown</span>
        <input id={filenameInputId} name="filename" value={filename} onChange={(event) => setFilename(event.target.value)}
          placeholder={t("例如：会议纪要.md")} disabled={saving} data-autofocus className="workflow-field"
          aria-describedby={filenameHintId} />
        <p id={filenameHintId} className="workflow-help">{t("保存为")} {normalizedFilename}</p>
      </div>
      <section id={editorRegionId} className="manual-input-editor" aria-label={t("Markdown 文档内容编辑器")}>
        <div className="manual-input-editor-heading"><h3>{t("文档内容")}</h3><span>{t("支持标题、列表、表格与代码")}</span></div>
        <div className="manual-input-md-editor">
          <MdEditor
            id={`manual-input-${mode}`}
            modelValue={content}
            onChange={(value) => setContent(value)}
            className="manual-input-md-editor__inner"
            theme={editorTheme}
            language={getLanguage() === 'en-US' ? 'en-US' : 'zh-CN'}
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
            placeholder={t("# 标题\n\n在这里写下要保存的内容…")}
          />
        </div>
      </section>
      {error && <p id={errorTextId} role="alert" className="manual-input-error">{error}</p>}
    </WorkflowDialog>
  )
}

export default ManualInputModal
