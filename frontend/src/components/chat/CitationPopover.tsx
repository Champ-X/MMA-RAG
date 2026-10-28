import { translate as tr, useTranslation } from '@/i18n'
import { ArrowUpRight, LocateFixed, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CitationReference } from '@/types/sse'
import { AttachmentEvidence } from './AttachmentEvidence'
import { SourceMediaPreview } from './SourceMediaPreview'
import { displayFileName, sourceTypes } from './sourceIdentity'
import { citationRailLayout } from './citationRailLayout'
import { activateCitationContext } from './citationContextHighlight'
import './citationRail.css'

interface CitationPopoverProps {
  open: boolean
  rect: DOMRect | null
  item: CitationReference | null
  displayNumber?: number | string
  anchor: HTMLElement | null
  workspace: HTMLElement | null
  composer: HTMLElement | null
  onClose: () => void
  onOpenInspector: () => void
}

export function CitationPopover({ open, rect, item, displayNumber, anchor, workspace, composer, onClose, onOpenInspector }: CitationPopoverProps) {
  useTranslation()
  const titleId = useId()
  const gradientId = useId().replace(/:/g, '')
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [layout, setLayout] = useState<ReturnType<typeof citationRailLayout> | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    let clearHighlight = activateCitationContext(anchor)
    let frame = 0
    // Text ranges survive scrolling/reflow. Rebuild only when streamed content changes.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        clearHighlight()
        clearHighlight = activateCitationContext(anchor)
      })
    })
    const answer = anchor.closest('.rag-markdown')
    if (answer) observer.observe(answer, { childList: true, characterData: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      clearHighlight()
    }
  }, [open, anchor])

  useLayoutEffect(() => {
    if (!open || !rect || !workspace) return
    let frame = 0
    // Column reflow must not move the citation away from the reader's current position.
    const viewport = workspace.querySelector('.chat-messages > div')
    if (anchor?.isConnected && viewport) viewport.scrollTop += anchor.getBoundingClientRect().top - rect.top
    anchor?.setAttribute('data-source-active', 'true')
    const update = () => {
      const bounds = workspace.getBoundingClientRect()
      const dockTop = composer?.getBoundingClientRect().top ?? bounds.bottom
      const bottom = Math.min(bounds.bottom, dockTop, window.innerHeight)
      const liveRect = anchor?.isConnected ? anchor.getBoundingClientRect() : rect
      const next = citationRailLayout(bounds, liveRect, bottom, panelRef.current?.getBoundingClientRect().height ?? 460, window.innerWidth,
        workspace.querySelector('.chat-message-log')?.getBoundingClientRect().right, window.innerHeight)
      setLayout(anchor?.isConnected ? next : { ...next, connector: null })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    update()
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }))
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    for (const element of [workspace, composer, anchor, panelRef.current, workspace.querySelector('.chat-message-content')]) if (element) observer?.observe(element)
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(focusFrame)
      observer?.disconnect()
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      anchor?.removeAttribute('data-source-active')
    }
  }, [open, item, anchor, workspace, composer, rect])

  if (!open || !item || !rect) return null
  const source = sourceTypes[item.type] || sourceTypes.doc
  const Icon = source.icon
  const name = displayFileName(item.file_name)
  const connector = layout?.connector
  return <>
    {connector && layout && <svg className="citation-connector" aria-hidden
      viewBox={`${layout.clip.left} ${layout.clip.top} ${layout.clip.width} ${layout.clip.height}`}
      style={{ left: layout.clip.left, top: layout.clip.top, width: layout.clip.width, height: layout.clip.height }}>
      <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={connector.fromX} y1={connector.fromY} x2={connector.toX} y2={connector.toY}>
        <stop offset="0" stopColor="var(--citation-line-start)" stopOpacity=".8" />
        <stop offset=".55" stopColor="currentColor" />
        <stop offset="1" stopColor="var(--citation-line-end)" stopOpacity=".9" />
      </linearGradient></defs>
      <path className="citation-connector__soft-edge" d={connector.path} />
      <path className="citation-connector__stroke" d={connector.path} stroke={`url(#${gradientId})`} />
      <circle className="citation-connector__halo" cx={connector.fromX} cy={connector.fromY} r="6" />
      <circle className="citation-connector__origin" cx={connector.fromX} cy={connector.fromY} r="3" />
      <circle className="citation-connector__pin" cx={connector.fromX} cy={connector.fromY} r="1" />
      <circle className="citation-connector__socket" cx={connector.toX - 1} cy={connector.toY} r="5" />
      <circle className="citation-connector__end" cx={connector.toX - 1} cy={connector.toY} r="2" />
    </svg>}
    <aside ref={panelRef} className="citation-rail" role="dialog" aria-modal="false" aria-labelledby={titleId}
      data-wide={layout?.wide} data-kind={item.type}
      style={layout ? { left: layout.left, top: layout.top, width: layout.width, maxHeight: layout.maxHeight } : { visibility: 'hidden' }}>
      <header className="citation-rail__header">
        <span className="citation-rail__number">{String(displayNumber ?? item.id).padStart(2, '0')}</span>
        <div className="citation-rail__identity"><p><Icon size={13} aria-hidden />{tr(source.label)}<span>·</span>{tr('引用来源')}</p>
          <h2 id={titleId} title={item.file_name}>{name}</h2></div>
        <button ref={closeRef} type="button" className="citation-rail__close" onClick={onClose} aria-label={tr('关闭引用预览')}><X size={17} aria-hidden /></button>
      </header>
      <div className="citation-rail__body" key={`${item.id}:${item.attachment_id}:${item.file_path}:${item.debug_info?.chunk_id}`}>
        {item.source === 'attachment' ? <AttachmentEvidence reference={item} displayNumber={displayNumber} preview />
          : item.type !== 'doc' && <SourceMediaPreview key={`${item.type}:${item.debug_info?.kb_id}:${item.file_path}:${item.img_url}:${item.audio_url}:${item.video_url}`} item={item} type={item.type} name={name} />}
        <div className="citation-rail__content-label">{tr(item.source === 'attachment' ? '回答依据的附件解析' : source.contentLabel)}</div>
        <p className="citation-rail__excerpt">{item.content?.trim() || tr('该来源暂未提供文字内容。')}</p>
      </div>
      <footer className="citation-rail__footer">
        <button type="button" className="citation-rail__locate" aria-label={tr('定位回答中的引用')} title={tr('定位回答中的引用')}
          disabled={!anchor?.isConnected} onClick={() => { anchor?.scrollIntoView({ block: 'center', behavior: 'instant' }); anchor?.focus({ preventScroll: true }) }}><LocateFixed size={16} aria-hidden /></button>
        <button type="button" className="citation-rail__details" onClick={onOpenInspector}>{tr('查看来源详情')}<ArrowUpRight size={16} aria-hidden /></button>
      </footer>
    </aside>
  </>
}
