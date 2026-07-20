import { useEffect, useRef } from 'react'
import { ArrowRight, Blocks, FileInput, FileSearch, FolderKanban, History, X } from 'lucide-react'
import { Link } from 'react-router-dom'

const concepts = [
  { term: 'Space', translation: '知识空间', icon: FolderKanban, definition: '围绕一个目标组织的可检索边界；决定一次问答可以使用哪些知识。', detail: 'A goal-oriented boundary over knowledge. It organizes Sources without copying them.' },
  { term: 'Source', translation: '原始材料', icon: FileInput, definition: '上传的文件或连接的网页、RSS、Git、文件夹等原始输入。', detail: 'The retained original. A Source may gain new immutable versions when upstream changes.' },
  { term: 'Evidence', translation: '可引用证据', icon: FileSearch, definition: '从原始材料中发布的不可变片段，可精确回到页码、图形、时间段或单元格。', detail: 'An immutable, addressable passage, figure, timestamp, or cell range used by citations.' },
  { term: 'Run', translation: '可恢复任务', icon: History, definition: '一次问答或深度研究的持久记录，保存范围、模型、阶段、引用与恢复点。', detail: 'A durable question or investigation. Refreshing the page does not erase its progress.' },
  { term: 'Artifact', translation: '可复用成果', icon: Blocks, definition: '由研究产生的结构化报告，有版本、证据绑定和可审核的刷新差异。', detail: 'A versioned outcome with stable Evidence bindings, distinct from a disposable chat attachment.' },
]

export function ConceptGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const guideRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open])
  if (!open) return null

  return <div className="concept-guide-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <aside
      ref={guideRef}
      className="concept-guide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="concept-guide-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
        if (event.key !== 'Tab') return
        const focusable = Array.from(guideRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href]') ?? [])
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}
    >
      <header><div><p className="eyebrow">Product language · 产品术语</p><h2 id="concept-guide-title">How knowledge moves through Nexus</h2><p>English product terms stay stable in APIs and URLs; the Chinese layer explains what they mean in everyday work.</p></div><button ref={closeRef} className="icon-button" aria-label="Close concept guide" onClick={onClose}><X /></button></header>
      <div className="concept-flow" aria-label="Knowledge lifecycle"><span>Source<small>原始材料</small></span><ArrowRight /><span>Evidence<small>可引用证据</small></span><ArrowRight /><span>Claim<small>可核验结论</small></span><ArrowRight /><span>Artifact<small>可复用成果</small></span></div>
      <div className="concept-list">{concepts.map(({ term, translation, icon: Icon, definition, detail }) => <article key={term}><span><Icon /></span><div><h3>{term}<small>{translation}</small></h3><p lang="zh-CN">{definition}</p><em>{detail}</em></div></article>)}</div>
      <footer><span><strong>Run · 可恢复任务</strong> freezes the Space, Source versions and Evidence ledger used for each turn.</span><div><Link to="/?guide=1" onClick={onClose}>Open getting started</Link><Link className="button primary" to="/spaces" onClick={onClose}>Browse Spaces<ArrowRight /></Link></div></footer>
    </aside>
  </div>
}
