import { translate as tr, useTranslation } from '@/i18n'
import { useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, ChevronDown, FileText, X } from 'lucide-react'
import type { CitationReference } from '@/types/sse'
import { citationScoreDetails } from '@/lib/citationScores'
import { SourceMediaPreview } from '../chat/SourceMediaPreview'
import { sourceTypes, displayFileName } from '../chat/sourceIdentity'
import { AttachmentEvidence } from '../chat/AttachmentEvidence'
import './inspectorDrawer.css'

interface InspectorDrawerProps {
  isOpen: boolean
  onClose: () => void
  /** 当前检查的引用项 */
  citations?: CitationReference[]
  /** 引用预览会在打开检查器时卸载；由调用侧保留原引用按钮。 */
  returnFocusTarget?: HTMLElement | null
  displayNumber?: number | string
}

function normalizeContextWindow(raw: unknown): { prev: string; next: string } | null {
  if (typeof raw === 'string') {
    try {
      return normalizeContextWindow(JSON.parse(raw))
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const prev = typeof obj.prev === 'string' ? obj.prev.trim() : ''
    const next = typeof obj.next === 'string' ? obj.next.trim() : ''
    if (prev || next) return { prev, next }
  }
  return null
}

function SourceMetadata({ item, displayNumber }: { item: CitationReference; displayNumber?: number | string }) {
  useTranslation()
  const scoreDetails = citationScoreDetails(item)
  const entries: Array<{ label: string; value: string | number | null | undefined; identifier?: boolean }> = [
    { label: tr("原始文件名"), value: item.file_name },
    { label: tr("来源路径"), value: item.file_path },
    { label: tr("素材类型"), value: tr(sourceTypes[item.type]?.label || item.type) },
    { label: tr("引用编号"), value: displayNumber ?? item.id },
    { label: tr("片段标识"), value: item.debug_info?.chunk_id, identifier: true },
    { label: tr("知识库标识"), value: item.debug_info?.kb_id, identifier: true },
    ...scoreDetails.entries,
  ]

  return (
    <details className="source-inspector-disclosure" open>
      <summary><span><FileText size={13} aria-hidden />{tr("文件与检索信息")}</span><ChevronDown size={14} aria-hidden /></summary>
      <dl className="source-inspector-metadata">
        {entries.filter(entry => entry.value != null && entry.value !== '').map(entry => (
          <div key={entry.label} style={{ display: 'contents' }}>
            <dt>{entry.label}</dt><dd data-identifier={entry.identifier || undefined}>{entry.value}</dd>
          </div>
        ))}
      </dl>
      <p className="source-inspector-score-note">{scoreDetails.note}</p>
    </details>
  )
}

export function InspectorDrawer({ isOpen, onClose, citations = [], returnFocusTarget, displayNumber }: InspectorDrawerProps) {
  useTranslation()
  const item = citations[0] || null
  const source = sourceTypes[item?.type || 'doc'] || sourceTypes.doc
  const Icon = source.icon
  const name = displayFileName(item?.file_name)
  const returnFocusRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const context = item?.type === 'doc' && item.debug_info?.chunk_id ? normalizeContextWindow(item.debug_info.context_window) : null
  const normalizedContent = (item?.content || '').replace(/\s+/g, ' ').trim()
  const previous = context?.prev && context.prev.replace(/\s+/g, ' ').trim() !== normalizedContent ? context.prev : ''
  const next = context?.next && context.next.replace(/\s+/g, ' ').trim() !== normalizedContent && context.next.replace(/\s+/g, ' ').trim() !== previous.replace(/\s+/g, ' ').trim() ? context.next : ''

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="source-inspector-overlay" />
        <Dialog.Content
          className="source-inspector"
          onCloseAutoFocus={event => {
            const target = returnFocusTarget?.isConnected ? returnFocusTarget : returnFocusRef.current
            if (target?.isConnected) {
              event.preventDefault()
              target.focus({ preventScroll: true })
            }
          }}
        >
          <header className="source-inspector-header">
            <div className="source-inspector-heading">
              <span className="source-inspector-icon"><Icon size={19} strokeWidth={1.65} aria-hidden /></span>
              <div className="source-inspector-title-group">
                <p className="source-inspector-kicker">{tr("来源详情")}</p>
                <Dialog.Title className="source-inspector-title" title={item?.file_name}>{item ? name : tr("查看引用来源")}</Dialog.Title>
              </div>
              <Dialog.Close className="source-inspector-close" aria-label={tr("关闭来源详情")}><X size={18} aria-hidden /></Dialog.Close>
            </div>
            <Dialog.Description className="source-inspector-description">
              {item ? <><span className="source-inspector-type">{tr(source.label)}</span><span>{tr("引用 {{v0}}", { v0: displayNumber ?? item.id })}</span><span>{item.source === 'attachment' ? tr("本机附件 · 来自此对话") : tr("回答的原始依据")}</span></> : tr("点击回答中的引用编号，阅读对应来源。")}
            </Dialog.Description>
          </header>
          <div className="source-inspector-scroll">
            {!item ? (
              <div className="source-inspector-empty"><FileText size={28} strokeWidth={1.3} aria-hidden /><p>{tr("选择一个引用，查看原始内容。")}</p></div>
            ) : (
              <div key={`${item.id}:${item.type}:${item.debug_info?.chunk_id || item.file_path || item.file_name}`}>
                {item.source === 'attachment' ? <AttachmentEvidence reference={item} displayNumber={displayNumber} preview /> : (item.type === 'image' || item.type === 'audio' || item.type === 'video') && <SourceMediaPreview key={`${item.type}:${item.debug_info?.kb_id}:${item.file_path}:${item.img_url}:${item.audio_url}:${item.video_url}`} item={item} type={item.type} name={name} />}
                <section className="source-inspector-content">
                  <div className="source-inspector-section-heading"><h3>{tr(source.contentLabel)}</h3>{item.type === 'doc' && <span>{tr("检索命中的片段")}</span>}</div>
                  {item.content?.trim() ? <div className="source-inspector-prose">{item.content}</div> : <p className="source-inspector-no-content">{tr("该来源暂未提供文字内容。")}</p>}
                </section>
                {(previous || next) && (
                  <details className="source-inspector-disclosure" open>
                    <summary><span>{tr("相邻原文")}</span><ChevronDown size={14} aria-hidden /></summary>
                    <div className="source-inspector-context">
                      {previous && <div><p className="source-inspector-context-label"><ArrowUp size={12} aria-hidden />{tr("上一段")}</p><div className="source-inspector-prose">{previous}</div></div>}
                      {next && <div><p className="source-inspector-context-label"><ArrowDown size={12} aria-hidden />{tr("下一段")}</p><div className="source-inspector-prose">{next}</div></div>}
                    </div>
                  </details>
                )}
                <SourceMetadata item={item} displayNumber={displayNumber} />
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default InspectorDrawer
